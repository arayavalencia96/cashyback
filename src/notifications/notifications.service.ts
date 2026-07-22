import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { createHash } from 'node:crypto';
import type { BatchResponse } from 'firebase-admin/messaging';

import {
  buildErrorResponse,
  buildSuccessResponse,
  type ApiResponse,
} from 'src/common/api-response';
import { readOptionalEnv } from 'src/common/env';
import { FirebaseAdminService } from 'src/common/services/firebase.service';

import type {
  DueReminderLogRecord,
  FixedExpenseNotificationRecord,
  ProcessDueRemindersResult,
  PushConfigResult,
  PushStatusResult,
  PushSubscribeResult,
  PushSubscriptionRecord,
  PushUnsubscribeResult,
} from './interfaces/push-notification.interface';

const PUSH_SUBSCRIPTIONS_COLLECTION = 'user_push_subscriptions';
const FIXED_EXPENSES_COLLECTION = 'fixedExpenses';
const DUE_REMINDER_LOG_COLLECTION = 'due_reminder_notification_log';
const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_DUE_SOON_REMINDER_DAYS = 3;

function stripUndefinedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly firebaseAdminService: FirebaseAdminService,
  ) {}

  getWebConfig(): ApiResponse<PushConfigResult> {
    const vapidPublicKey = this.getVapidPublicKey();

    return buildSuccessResponse(
      {
        enabled: Boolean(vapidPublicKey),
        vapidPublicKey: vapidPublicKey ?? null,
      },
      'Configuracion de notificaciones obtenida',
      'Se resolvio la configuracion web push para el frontend.',
      200,
    );
  }

  async getStatus(uid: string): Promise<ApiResponse<PushStatusResult>> {
    const activeDeviceCount = await this.countActiveSubscriptions(uid);

    return buildSuccessResponse(
      {
        supported: true,
        configured: Boolean(this.getVapidPublicKey()),
        activeDeviceCount,
      },
      'Estado de notificaciones obtenido',
      'Se obtuvo el estado de notificaciones push para el usuario actual.',
      200,
    );
  }

  async subscribeWebPush(
    uid: string,
    input: {
      token: string;
      platform: 'web';
      deviceId: string;
      userAgent?: string;
    },
  ): Promise<ApiResponse<PushSubscribeResult>> {
    this.ensurePushConfigured();

    if (!input.token?.trim() || !input.deviceId?.trim()) {
      throw new BadRequestException(
        buildErrorResponse(
          'Token push invalido',
          'Debes enviar un token y un identificador de dispositivo validos.',
          400,
        ),
      );
    }

    const now = new Date().toISOString();
    const documentId = this.hashToken(input.token);
    const collection = this.firebaseAdminService.firestore.collection(
      PUSH_SUBSCRIPTIONS_COLLECTION,
    );
    const existingSnapshot = await collection.doc(documentId).get();
    const existing = existingSnapshot.exists
      ? (existingSnapshot.data() as PushSubscriptionRecord)
      : null;
    await this.deletePreviousDeviceSubscriptions(
      uid,
      input.deviceId.trim(),
      documentId,
    );

    const record: PushSubscriptionRecord = {
      uid,
      token: input.token.trim(),
      platform: 'web',
      deviceId: input.deviceId.trim(),
      userAgent: input.userAgent?.trim() || null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      active: true,
      lastTokenRefreshAt: now,
      lastSuccessAt: existing?.lastSuccessAt,
      lastFailureAt: undefined,
      lastFailureCode: undefined,
    };

    await collection.doc(documentId).set(stripUndefinedFields(record));

    return buildSuccessResponse(
      {
        subscribed: true,
        activeDeviceCount: await this.countActiveSubscriptions(uid),
      },
      'Notificaciones activadas',
      'Este dispositivo ya puede recibir notificaciones push.',
      200,
    );
  }

  async unsubscribeWebPush(
    uid: string,
    token: string,
  ): Promise<ApiResponse<PushUnsubscribeResult>> {
    if (!token?.trim()) {
      throw new BadRequestException(
        buildErrorResponse(
          'Token push invalido',
          'Debes enviar un token valido para desuscribirte.',
          400,
        ),
      );
    }

    const documentId = this.hashToken(token);
    const document = this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .doc(documentId);
    const snapshot = await document.get();

    if (snapshot.exists) {
      const data = snapshot.data() as PushSubscriptionRecord;

      if (data.uid === uid) {
        await document.delete();
      }
    }

    return buildSuccessResponse(
      {
        unsubscribed: true,
        activeDeviceCount: await this.countActiveSubscriptions(uid),
      },
      'Notificaciones desactivadas',
      'Este dispositivo dejo de recibir notificaciones push.',
      200,
    );
  }

  async processDueReminders(): Promise<ApiResponse<ProcessDueRemindersResult>> {
    this.ensurePushConfigured();
    const todayKey = this.getTodayDateKey();
    const dueSoonReminderDays = this.getDueSoonReminderDays();
    const dueSoonEndKey = this.addDaysToDateKey(todayKey, dueSoonReminderDays);
    const overdueExpenses = await this.queryOverdueExpenses(todayKey);
    const dueSoonExpenses = await this.queryDueSoonExpenses(
      todayKey,
      dueSoonEndKey,
    );

    const overdueByUser = this.groupExpensesByUser(overdueExpenses);
    const dueSoonByUser = this.groupExpensesByUser(dueSoonExpenses);
    const candidateUsers = new Set<string>([
      ...overdueByUser.keys(),
      ...dueSoonByUser.keys(),
    ]);

    if (candidateUsers.size === 0) {
      return buildSuccessResponse(
        {
          dateKey: todayKey,
          processedUsers: 0,
          notifiedUsers: 0,
          overdueUsers: 0,
          dueSoonUsers: 0,
          skippedAlreadySent: 0,
          usersWithoutSubscriptions: 0,
          deliveredCount: 0,
          failedCount: 0,
        },
        'Sin recordatorios pendientes',
        'No se encontraron gastos vencidos ni por vencer para notificar hoy.',
        200,
      );
    }

    const alreadySentUsers = await this.getLoggedUsersForDate(
      Array.from(candidateUsers),
      todayKey,
    );
    const subscriptionsByUser = await this.listActiveSubscriptionsByUserIds(
      Array.from(candidateUsers),
    );

    let notifiedUsers = 0;
    let overdueUsers = 0;
    let dueSoonUsers = 0;
    let skippedAlreadySent = 0;
    let usersWithoutSubscriptions = 0;
    let deliveredCount = 0;
    let failedCount = 0;

    for (const uid of candidateUsers) {
      if (alreadySentUsers.has(uid)) {
        skippedAlreadySent += 1;
        continue;
      }

      const subscriptions = subscriptionsByUser.get(uid) ?? [];

      if (subscriptions.length === 0) {
        usersWithoutSubscriptions += 1;
        continue;
      }

      const overdueItems = overdueByUser.get(uid) ?? [];

      if (overdueItems.length > 0) {
        const sendResult = await this.sendNotificationToSubscriptions(
          subscriptions,
          {
            notificationId: `${todayKey}:${uid}:overdue`,
            title: 'Cashy',
            body: 'Tenes vencido un gasto.',
            url: this.buildFixedExpensesUrl(),
          },
        );

        if (sendResult.delivered > 0) {
          notifiedUsers += 1;
          overdueUsers += 1;
          deliveredCount += sendResult.delivered;
          failedCount += sendResult.failed;
          await this.createDueReminderLog({
            uid,
            dateKey: todayKey,
            reminderType: 'overdue',
            expenseIds: overdueItems.map((item) => item.id),
            sentAt: new Date().toISOString(),
            deliveredCount: sendResult.delivered,
            failedCount: sendResult.failed,
            dueDate: this.getEarliestDueDate(overdueItems),
            daysUntilDue: null,
          });
        }

        continue;
      }

      const dueSoonItems = dueSoonByUser.get(uid) ?? [];

      if (dueSoonItems.length === 0) {
        continue;
      }

      const nearestDueDate = this.getEarliestDueDate(dueSoonItems);

      if (!nearestDueDate) {
        continue;
      }

      const daysUntilDue = this.diffDaysBetweenDateKeys(todayKey, nearestDueDate);
      const sendResult = await this.sendNotificationToSubscriptions(
        subscriptions,
        {
          notificationId: `${todayKey}:${uid}:due-soon`,
          title: 'Cashy',
          body: this.buildDueSoonMessage(daysUntilDue, dueSoonItems.length),
          url: this.buildFixedExpensesUrl(),
        },
      );

      if (sendResult.delivered > 0) {
        notifiedUsers += 1;
        dueSoonUsers += 1;
        deliveredCount += sendResult.delivered;
        failedCount += sendResult.failed;
        await this.createDueReminderLog({
          uid,
          dateKey: todayKey,
          reminderType: 'due-soon',
          expenseIds: dueSoonItems.map((item) => item.id),
          sentAt: new Date().toISOString(),
          deliveredCount: sendResult.delivered,
          failedCount: sendResult.failed,
          dueDate: nearestDueDate,
          daysUntilDue,
        });
      }
    }

    return buildSuccessResponse(
      {
        dateKey: todayKey,
        processedUsers: candidateUsers.size,
        notifiedUsers,
        overdueUsers,
        dueSoonUsers,
        skippedAlreadySent,
        usersWithoutSubscriptions,
        deliveredCount,
        failedCount,
      },
      'Recordatorios procesados',
      'Se procesaron los recordatorios diarios de gastos vencidos y por vencer.',
      200,
    );
  }

  private getVapidPublicKey(): string | undefined {
    return readOptionalEnv('FIREBASE_WEB_PUSH_PUBLIC_KEY');
  }

  private ensurePushConfigured(): void {
    if (this.getVapidPublicKey()) {
      return;
    }

    throw new BadRequestException(
      buildErrorResponse(
        'Notificaciones no configuradas',
        'Falta configurar FIREBASE_WEB_PUSH_PUBLIC_KEY en el backend.',
        400,
      ),
    );
  }

  private async countActiveSubscriptions(uid: string): Promise<number> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .where('uid', '==', uid)
      .where('active', '==', true)
      .get();

    return snapshot.size;
  }

  private async listActiveSubscriptions(
    uid: string,
  ): Promise<Array<PushSubscriptionRecord>> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .where('uid', '==', uid)
      .where('active', '==', true)
      .get();

    return snapshot.docs.map((document) => document.data() as PushSubscriptionRecord);
  }

  private async deletePreviousDeviceSubscriptions(
    uid: string,
    deviceId: string,
    currentDocumentId: string,
  ): Promise<void> {
    const subscriptions = await this.listActiveSubscriptions(uid);
    const duplicates = subscriptions.filter(
      (subscription) =>
        subscription.deviceId === deviceId &&
        this.hashToken(subscription.token) !== currentDocumentId,
    );

    await Promise.all(
      duplicates.map((subscription) => this.deleteSubscription(subscription.token)),
    );
  }

  private async listActiveSubscriptionsByUserIds(
    userIds: Array<string>,
  ): Promise<Map<string, Array<PushSubscriptionRecord>>> {
    const grouped = new Map<string, Array<PushSubscriptionRecord>>();

    for (const chunk of this.chunkArray(userIds, 10)) {
      const snapshot = await this.firebaseAdminService.firestore
        .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
        .where('uid', 'in', chunk)
        .where('active', '==', true)
        .get();

      for (const document of snapshot.docs) {
        const subscription = document.data() as PushSubscriptionRecord;
        const current = grouped.get(subscription.uid) ?? [];

        current.push(subscription);
        grouped.set(subscription.uid, current);
      }
    }

    return grouped;
  }

  private async queryOverdueExpenses(
    todayKey: string,
  ): Promise<Array<{ id: string; data: FixedExpenseNotificationRecord }>> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(FIXED_EXPENSES_COLLECTION)
      .where('dueDate', '<', todayKey)
      .get();

    return snapshot.docs
      .map((document) => ({
        id: document.id,
        data: document.data() as FixedExpenseNotificationRecord,
      }))
      .filter((item) => this.isPendingExpense(item.data));
  }

  private async queryDueSoonExpenses(
    todayKey: string,
    dueSoonEndKey: string,
  ): Promise<Array<{ id: string; data: FixedExpenseNotificationRecord }>> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(FIXED_EXPENSES_COLLECTION)
      .where('dueDate', '>=', todayKey)
      .where('dueDate', '<=', dueSoonEndKey)
      .get();

    return snapshot.docs
      .map((document) => ({
        id: document.id,
        data: document.data() as FixedExpenseNotificationRecord,
      }))
      .filter((item) => this.isPendingExpense(item.data));
  }

  private groupExpensesByUser(
    items: Array<{ id: string; data: FixedExpenseNotificationRecord }>,
  ): Map<string, Array<{ id: string; data: FixedExpenseNotificationRecord }>> {
    const grouped = new Map<
      string,
      Array<{ id: string; data: FixedExpenseNotificationRecord }>
    >();

    for (const item of items) {
      const dueDate = item.data.dueDate?.trim();

      if (!item.data.userId || !dueDate) {
        continue;
      }

      const current = grouped.get(item.data.userId) ?? [];

      current.push({
        id: item.id,
        data: {
          ...item.data,
          dueDate,
        },
      });
      grouped.set(item.data.userId, current);
    }

    return grouped;
  }

  private isPendingExpense(item: FixedExpenseNotificationRecord): boolean {
    if (!item.dueDate?.trim()) {
      return false;
    }

    if (item.paymentStatus) {
      return item.paymentStatus === 'pending';
    }

    if (typeof item.partialPaymentAmount === 'number' && item.partialPaymentAmount > 0) {
      return false;
    }

    return item.isPaid !== true;
  }

  private async getLoggedUsersForDate(
    userIds: Array<string>,
    dateKey: string,
  ): Promise<Set<string>> {
    const loggedUsers = new Set<string>();

    for (const chunk of this.chunkArray(userIds, 10)) {
      const snapshot = await this.firebaseAdminService.firestore
        .collection(DUE_REMINDER_LOG_COLLECTION)
        .where('dateKey', '==', dateKey)
        .where('uid', 'in', chunk)
        .get();

      for (const document of snapshot.docs) {
        const data = document.data() as DueReminderLogRecord;

        if (data.uid) {
          loggedUsers.add(data.uid);
        }
      }
    }

    return loggedUsers;
  }

  private async createDueReminderLog(record: DueReminderLogRecord): Promise<void> {
    const documentId = `${record.dateKey}_${record.uid}`;

    await this.firebaseAdminService.firestore
      .collection(DUE_REMINDER_LOG_COLLECTION)
      .doc(documentId)
      .set(record);
  }

  private async sendNotificationToSubscriptions(
    subscriptions: Array<PushSubscriptionRecord>,
    payload: {
      notificationId: string;
      title: string;
      body: string;
      url: string;
    },
  ): Promise<{ delivered: number; failed: number }> {
    const response = await this.firebaseAdminService.messaging.sendEachForMulticast(
      {
        tokens: subscriptions.map((subscription) => subscription.token),
        data: {
          notificationId: payload.notificationId,
          title: payload.title,
          body: payload.body,
          url: payload.url,
          icon: '/cashy-logo.svg',
        },
        webpush: {
          fcmOptions: {
            link: payload.url,
          },
        },
      },
      false,
    );

    await this.handleSendResponse(subscriptions, response);

    return {
      delivered: response.successCount,
      failed: response.failureCount,
    };
  }

  private async handleSendResponse(
    subscriptions: Array<PushSubscriptionRecord>,
    response: BatchResponse,
  ): Promise<void> {
    const updates: Array<Promise<unknown>> = [];
    const now = new Date().toISOString();

    response.responses.forEach((result, index) => {
      const subscription = subscriptions[index];

      if (!subscription) {
        return;
      }

      if (result.success) {
        updates.push(
          this.updateSubscriptionMetadata(subscription.token, {
            lastSuccessAt: now,
            lastFailureAt: undefined,
            lastFailureCode: undefined,
          }),
        );
        return;
      }

      const errorCode = result.error?.code ?? 'messaging/unknown-error';

      if (INVALID_TOKEN_ERROR_CODES.has(errorCode)) {
        updates.push(this.deleteSubscription(subscription.token));
        return;
      }

      this.logger.warn(
        `Push send failure for uid=${subscription.uid}: ${errorCode}`,
      );
      updates.push(
        this.updateSubscriptionMetadata(subscription.token, {
          lastFailureAt: now,
          lastFailureCode: errorCode,
        }),
      );
    });

    await Promise.all(updates);
  }

  private async updateSubscriptionMetadata(
    token: string,
    patch: Partial<PushSubscriptionRecord>,
  ): Promise<void> {
    const documentId = this.hashToken(token);

    await this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .doc(documentId)
      .set(stripUndefinedFields({
        ...patch,
        updatedAt: new Date().toISOString(),
      }), { merge: true });
  }

  private async deleteSubscription(token: string): Promise<void> {
    const documentId = this.hashToken(token);

    await this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .doc(documentId)
      .delete();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildFixedExpensesUrl(): string {
    const appBaseUrl =
      readOptionalEnv('APP_BASE_URL') ?? 'https://cashy-cd3e6.web.app';

    return `${appBaseUrl.replace(/\/+$/, '')}/fijos`;
  }

  private getTodayDateKey(): string {
    return this.formatDateKeyInTimeZone(new Date(), DEFAULT_TIME_ZONE);
  }

  private getDueSoonReminderDays(): number {
    const rawValue = Number(readOptionalEnv('DUE_SOON_REMINDER_DAYS'));

    if (!Number.isFinite(rawValue)) {
      return DEFAULT_DUE_SOON_REMINDER_DAYS;
    }

    return Math.max(0, Math.floor(rawValue));
  }

  private formatDateKeyInTimeZone(date: Date, timeZone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
      throw new Error('No se pudo resolver la fecha actual en la zona horaria configurada.');
    }

    return `${year}-${month}-${day}`;
  }

  private addDaysToDateKey(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    date.setUTCDate(date.getUTCDate() + days);

    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  private diffDaysBetweenDateKeys(from: string, to: string): number {
    const fromDate = this.parseDateKey(from);
    const toDate = this.parseDateKey(to);

    return Math.round(
      (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000),
    );
  }

  private parseDateKey(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private getEarliestDueDate(
    items: Array<{ id: string; data: FixedExpenseNotificationRecord }>,
  ): string | null {
    const dueDates = items
      .map((item) => item.data.dueDate)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort((left, right) => left.localeCompare(right));

    return dueDates[0] ?? null;
  }

  private buildDueSoonMessage(daysUntilDue: number, expenseCount: number): string {
    if (daysUntilDue <= 0) {
      return expenseCount > 1
        ? 'Recorda que hoy vencen gastos.'
        : 'Recorda que hoy vence un gasto.';
    }

    if (expenseCount > 1) {
      return `Recorda que en ${daysUntilDue} ${daysUntilDue === 1 ? 'dia' : 'dias'} vencen gastos.`;
    }

    return `Recorda que en ${daysUntilDue} ${daysUntilDue === 1 ? 'dia' : 'dias'} vence un gasto.`;
  }

  private chunkArray<T>(items: Array<T>, size: number): Array<Array<T>> {
    const chunks: Array<Array<T>> = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }
}
