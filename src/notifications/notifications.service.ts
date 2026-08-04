import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
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
  DueReminderProcessingStats,
  FixedExpenseNotificationRecord,
  ProcessDueRemindersResult,
  ProcessUserDueReminderInput,
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
const DUE_REMINDER_LOG_RETENTION_DAYS = 30;
const RETENTION_DELETE_BATCH_SIZE = 400;
const TECHNICAL_RETENTION_COLLECTIONS = [
  'user_block_codes',
  'user_password_recovery_sessions',
  'user_login_attempts',
  DUE_REMINDER_LOG_COLLECTION,
] as const;

function stripUndefinedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly firebaseAdminService: FirebaseAdminService) {}

  /**
   * Obtiene la configuración pública de Firebase Web Push.
   *
   * @returns Estado de configuración y clave pública VAPID.
   */
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

  /**
   * Consulta cuántos dispositivos activos tiene suscritos un usuario.
   *
   * @param uid Identificador del usuario autenticado.
   * @returns Estado de soporte, configuración y cantidad de dispositivos.
   */
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

  /**
   * Registra o actualiza una suscripción web push para un dispositivo.
   *
   * @param uid Identificador del usuario propietario.
   * @param input Token, plataforma e información del dispositivo.
   * @returns Confirmación y cantidad actual de dispositivos activos.
   */
  async subscribeWebPush(
    uid: string,
    input: {
      fid: string;
      platform: 'web';
      deviceId: string;
      userAgent?: string;
    },
  ): Promise<ApiResponse<PushSubscribeResult>> {
    this.ensurePushConfigured();

    if (!input.fid?.trim() || !input.deviceId?.trim()) {
      throw new BadRequestException(
        buildErrorResponse(
          'Token push invalido',
          'Debes enviar un token y un identificador de dispositivo validos.',
          400,
        ),
      );
    }

    const now = new Date().toISOString();
    const documentId = this.hashPushIdentifier(input.fid);
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
      fid: input.fid.trim(),
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

  /**
   * Elimina una suscripción web push cuando pertenece al usuario indicado.
   *
   * @param uid Identificador del usuario propietario.
   * @param token Token de registro que se debe eliminar.
   * @returns Confirmación y cantidad restante de dispositivos activos.
   */
  async unsubscribeWebPush(
    uid: string,
    fid: string,
  ): Promise<ApiResponse<PushUnsubscribeResult>> {
    if (!fid?.trim()) {
      throw new BadRequestException(
        buildErrorResponse(
          'Token push invalido',
          'Debes enviar un token valido para desuscribirte.',
          400,
        ),
      );
    }

    const documentId = this.hashPushIdentifier(fid);
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

  /**
   * Procesa los gastos vencidos y próximos a vencer de todos los usuarios.
   *
   * @returns Métricas de usuarios procesados y notificaciones entregadas.
   */
  async processDueReminders(): Promise<ApiResponse<ProcessDueRemindersResult>> {
    await this.cleanupExpiredTechnicalRecords();
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

    const stats = this.createEmptyDueReminderStats();

    for (const uid of candidateUsers) {
      const userStats = await this.processUserDueReminder({
        uid,
        todayKey,
        alreadySent: alreadySentUsers.has(uid),
        subscriptions: subscriptionsByUser.get(uid) ?? [],
        overdueItems: overdueByUser.get(uid) ?? [],
        dueSoonItems: dueSoonByUser.get(uid) ?? [],
      });

      this.mergeDueReminderStats(stats, userStats);
    }

    return buildSuccessResponse(
      {
        dateKey: todayKey,
        processedUsers: candidateUsers.size,
        ...stats,
      },
      'Recordatorios procesados',
      'Se procesaron los recordatorios diarios de gastos vencidos y por vencer.',
      200,
    );
  }

  /** Elimina registros técnicos cuyo plazo de retención ya finalizó. */
  private async cleanupExpiredTechnicalRecords(): Promise<void> {
    const now = Date.now();
    let deletedCount = 0;

    for (const collectionName of TECHNICAL_RETENTION_COLLECTIONS) {
      const snapshot = await this.firebaseAdminService.firestore
        .collection(collectionName)
        .get();
      const expiredDocuments = snapshot.docs.filter((document) => {
        const deleteAtDate = this.parseRetentionDate(
          document.data()['deleteAt'],
        );

        return deleteAtDate !== null && deleteAtDate.getTime() <= now;
      });

      for (
        let index = 0;
        index < expiredDocuments.length;
        index += RETENTION_DELETE_BATCH_SIZE
      ) {
        const batch = this.firebaseAdminService.firestore.batch();

        for (const document of expiredDocuments.slice(
          index,
          index + RETENTION_DELETE_BATCH_SIZE,
        )) {
          batch.delete(document.ref);
        }

        await batch.commit();
      }

      deletedCount += expiredDocuments.length;
    }

    if (deletedCount > 0) {
      this.logger.log(
        `Retention cleanup removed ${deletedCount} expired technical records.`,
      );
    }
  }

  private parseRetentionDate(value: unknown): Date | null {
    if (value instanceof Timestamp) {
      return value.toDate();
    }

    return value instanceof Date ? value : null;
  }

  /**
   * Determina y procesa el recordatorio correspondiente a un usuario.
   *
   * @param input Suscripciones, gastos y estado diario del usuario.
   * @returns Variación de métricas producida por el procesamiento.
   */
  private async processUserDueReminder(
    input: ProcessUserDueReminderInput,
  ): Promise<DueReminderProcessingStats> {
    if (input.alreadySent) {
      return {
        ...this.createEmptyDueReminderStats(),
        skippedAlreadySent: 1,
      };
    }

    if (input.subscriptions.length === 0) {
      return {
        ...this.createEmptyDueReminderStats(),
        usersWithoutSubscriptions: 1,
      };
    }

    if (input.overdueItems.length > 0) {
      return this.sendOverdueReminder(input);
    }

    return this.sendDueSoonReminder(input);
  }

  /**
   * Envía y registra un recordatorio de gastos vencidos.
   *
   * @param input Datos del usuario y sus gastos vencidos.
   * @returns Métricas de entrega del recordatorio.
   */
  private async sendOverdueReminder(
    input: ProcessUserDueReminderInput,
  ): Promise<DueReminderProcessingStats> {
    const sendResult = await this.sendNotificationToSubscriptions(
      input.subscriptions,
      {
        notificationId: `${input.todayKey}:${input.uid}:overdue`,
        title: 'Cashy',
        body: 'Tenes vencido un gasto.',
        url: this.buildFixedExpensesUrl(),
      },
    );

    if (sendResult.delivered === 0) {
      return this.createEmptyDueReminderStats();
    }

    await this.createDueReminderLog({
      uid: input.uid,
      dateKey: input.todayKey,
      reminderType: 'overdue',
      expenseIds: input.overdueItems.map((item) => item.id),
      sentAt: new Date().toISOString(),
      deliveredCount: sendResult.delivered,
      failedCount: sendResult.failed,
      dueDate: this.getEarliestDueDate(input.overdueItems),
      daysUntilDue: null,
    });

    return {
      ...this.createEmptyDueReminderStats(),
      notifiedUsers: 1,
      overdueUsers: 1,
      deliveredCount: sendResult.delivered,
      failedCount: sendResult.failed,
    };
  }

  /**
   * Envía y registra un recordatorio de próximos vencimientos.
   *
   * @param input Datos del usuario y sus gastos por vencer.
   * @returns Métricas de entrega del recordatorio.
   */
  private async sendDueSoonReminder(
    input: ProcessUserDueReminderInput,
  ): Promise<DueReminderProcessingStats> {
    const nearestDueDate = this.getEarliestDueDate(input.dueSoonItems);

    if (!nearestDueDate) {
      return this.createEmptyDueReminderStats();
    }

    const daysUntilDue = this.diffDaysBetweenDateKeys(
      input.todayKey,
      nearestDueDate,
    );
    const sendResult = await this.sendNotificationToSubscriptions(
      input.subscriptions,
      {
        notificationId: `${input.todayKey}:${input.uid}:due-soon`,
        title: 'Cashy',
        body: this.buildDueSoonMessage(daysUntilDue, input.dueSoonItems.length),
        url: this.buildFixedExpensesUrl(),
      },
    );

    if (sendResult.delivered === 0) {
      return this.createEmptyDueReminderStats();
    }

    await this.createDueReminderLog({
      uid: input.uid,
      dateKey: input.todayKey,
      reminderType: 'due-soon',
      expenseIds: input.dueSoonItems.map((item) => item.id),
      sentAt: new Date().toISOString(),
      deliveredCount: sendResult.delivered,
      failedCount: sendResult.failed,
      dueDate: nearestDueDate,
      daysUntilDue,
    });

    return {
      ...this.createEmptyDueReminderStats(),
      notifiedUsers: 1,
      dueSoonUsers: 1,
      deliveredCount: sendResult.delivered,
      failedCount: sendResult.failed,
    };
  }

  /**
   * Crea un conjunto de métricas inicializado en cero.
   *
   * @returns Estadísticas vacías para acumular resultados.
   */
  private createEmptyDueReminderStats(): DueReminderProcessingStats {
    return {
      notifiedUsers: 0,
      overdueUsers: 0,
      dueSoonUsers: 0,
      skippedAlreadySent: 0,
      usersWithoutSubscriptions: 0,
      deliveredCount: 0,
      failedCount: 0,
    };
  }

  /**
   * Acumula las métricas de un usuario en el resultado general.
   *
   * @param target Estadísticas generales que se deben modificar.
   * @param source Estadísticas que se deben sumar.
   */
  private mergeDueReminderStats(
    target: DueReminderProcessingStats,
    source: DueReminderProcessingStats,
  ): void {
    target.notifiedUsers += source.notifiedUsers;
    target.overdueUsers += source.overdueUsers;
    target.dueSoonUsers += source.dueSoonUsers;
    target.skippedAlreadySent += source.skippedAlreadySent;
    target.usersWithoutSubscriptions += source.usersWithoutSubscriptions;
    target.deliveredCount += source.deliveredCount;
    target.failedCount += source.failedCount;
  }

  /**
   * Lee la clave pública VAPID configurada para Firebase Web Push.
   *
   * @returns Clave pública o `undefined` cuando no está configurada.
   */
  private getVapidPublicKey(): string | undefined {
    return readOptionalEnv('FIREBASE_WEB_PUSH_PUBLIC_KEY');
  }

  /**
   * Comprueba que exista la configuración mínima para enviar notificaciones.
   *
   * @throws BadRequestException Si falta la clave pública VAPID.
   */
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

  /**
   * Cuenta las suscripciones activas asociadas a un usuario.
   *
   * @param uid Identificador del usuario.
   * @returns Cantidad de suscripciones activas.
   */
  private async countActiveSubscriptions(uid: string): Promise<number> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .where('uid', '==', uid)
      .where('active', '==', true)
      .get();

    return snapshot.size;
  }

  /**
   * Obtiene todas las suscripciones activas de un usuario.
   *
   * @param uid Identificador del usuario.
   * @returns Suscripciones activas encontradas en Firestore.
   */
  private async listActiveSubscriptions(
    uid: string,
  ): Promise<Array<PushSubscriptionRecord>> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .where('uid', '==', uid)
      .where('active', '==', true)
      .get();

    return snapshot.docs.map(
      (document) => document.data() as PushSubscriptionRecord,
    );
  }

  /**
   * Elimina tokens anteriores del mismo usuario y dispositivo.
   *
   * @param uid Identificador del usuario.
   * @param deviceId Identificador estable del dispositivo.
   * @param currentDocumentId Hash del token que debe conservarse.
   */
  private async deletePreviousDeviceSubscriptions(
    uid: string,
    deviceId: string,
    currentDocumentId: string,
  ): Promise<void> {
    const subscriptions = await this.listActiveSubscriptions(uid);
    const duplicates = subscriptions.filter(
      (subscription) =>
        subscription.deviceId === deviceId &&
        this.hashPushIdentifier(this.getPushIdentifier(subscription)) !==
          currentDocumentId,
    );

    await Promise.all(
      duplicates.map((subscription) =>
        this.deleteSubscription(this.getPushIdentifier(subscription)),
      ),
    );
  }

  /**
   * Obtiene y agrupa suscripciones activas para varios usuarios.
   *
   * @param userIds Identificadores que se deben consultar.
   * @returns Suscripciones indexadas por identificador de usuario.
   */
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

  /**
   * Consulta gastos pendientes con vencimiento anterior a la fecha actual.
   *
   * @param todayKey Fecha actual con formato `YYYY-MM-DD`.
   * @returns Gastos vencidos que todavía requieren pago.
   */
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

  /**
   * Consulta gastos pendientes dentro del rango de próximos vencimientos.
   *
   * @param todayKey Inicio del rango con formato `YYYY-MM-DD`.
   * @param dueSoonEndKey Fin inclusivo del rango.
   * @returns Gastos pendientes que vencen dentro del rango.
   */
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

  /**
   * Agrupa gastos válidos por su usuario propietario.
   *
   * @param items Documentos de gastos obtenidos desde Firestore.
   * @returns Gastos indexados por identificador de usuario.
   */
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

  /**
   * Determina si un gasto todavía debe considerarse pendiente.
   *
   * @param item Datos del gasto fijo.
   * @returns `true` cuando admite el envío de un recordatorio.
   */
  private isPendingExpense(item: FixedExpenseNotificationRecord): boolean {
    if (!item.dueDate?.trim()) {
      return false;
    }

    if (item.paymentStatus) {
      return item.paymentStatus === 'pending';
    }

    if (
      typeof item.partialPaymentAmount === 'number' &&
      item.partialPaymentAmount > 0
    ) {
      return false;
    }

    return item.isPaid !== true;
  }

  /**
   * Obtiene los usuarios que ya recibieron un recordatorio en una fecha.
   *
   * @param userIds Usuarios candidatos al envío.
   * @param dateKey Fecha diaria con formato `YYYY-MM-DD`.
   * @returns Identificadores con un registro diario existente.
   */
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

  /**
   * Persiste el resultado de un recordatorio diario entregado.
   *
   * @param record Datos de entrega y gastos asociados.
   */
  private async createDueReminderLog(
    record: DueReminderLogRecord,
  ): Promise<void> {
    const documentId = `${record.dateKey}_${record.uid}`;
    const sentAt = new Date(record.sentAt);
    const deleteAt = new Date(
      sentAt.getTime() + DUE_REMINDER_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.firebaseAdminService.firestore
      .collection(DUE_REMINDER_LOG_COLLECTION)
      .doc(documentId)
      .set({ ...record, deleteAt });
  }

  /**
   * Envía una notificación a todas las suscripciones indicadas.
   *
   * @param subscriptions Dispositivos destinatarios.
   * @param payload Identificador, contenido y URL de la notificación.
   * @returns Cantidades de entregas exitosas y fallidas.
   */
  private async sendNotificationToSubscriptions(
    subscriptions: Array<PushSubscriptionRecord>,
    payload: {
      notificationId: string;
      title: string;
      body: string;
      url: string;
    },
  ): Promise<{ delivered: number; failed: number }> {
    const response = await this.firebaseAdminService.messaging.sendEach(
      subscriptions.map((subscription) => ({
        ...(subscription.fid
          ? { fid: subscription.fid }
          : { token: subscription.token ?? '' }),
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
      })),
      false,
    );

    await this.handleSendResponse(subscriptions, response);

    return {
      delivered: response.successCount,
      failed: response.failureCount,
    };
  }

  /**
   * Actualiza o elimina suscripciones según la respuesta de Firebase.
   *
   * @param subscriptions Suscripciones en el mismo orden que las respuestas.
   * @param response Resultado por destinatario devuelto por Firebase.
   */
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
          this.updateSubscriptionMetadata(
            this.getPushIdentifier(subscription),
            {
              lastSuccessAt: now,
              lastFailureAt: undefined,
              lastFailureCode: undefined,
            },
          ),
        );
        return;
      }

      const errorCode = result.error?.code ?? 'messaging/unknown-error';

      if (INVALID_TOKEN_ERROR_CODES.has(errorCode)) {
        updates.push(
          this.deleteSubscription(this.getPushIdentifier(subscription)),
        );
        return;
      }

      this.logger.warn(
        `Push send failure for uid=${subscription.uid}: ${errorCode}`,
      );
      updates.push(
        this.updateSubscriptionMetadata(this.getPushIdentifier(subscription), {
          lastFailureAt: now,
          lastFailureCode: errorCode,
        }),
      );
    });

    await Promise.all(updates);
  }

  /**
   * Actualiza los metadatos operativos de una suscripción.
   *
   * @param token Token utilizado para identificar el documento.
   * @param patch Campos que se deben actualizar.
   */
  private async updateSubscriptionMetadata(
    token: string,
    patch: Partial<PushSubscriptionRecord>,
  ): Promise<void> {
    const documentId = this.hashPushIdentifier(token);

    await this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .doc(documentId)
      .set(
        stripUndefinedFields({
          ...patch,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true },
      );
  }

  /**
   * Elimina de Firestore una suscripción identificada por su token.
   *
   * @param token Token de registro que se debe eliminar.
   */
  private async deleteSubscription(token: string): Promise<void> {
    const documentId = this.hashPushIdentifier(token);

    await this.firebaseAdminService.firestore
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .doc(documentId)
      .delete();
  }

  /**
   * Genera el identificador persistente de una suscripción.
   *
   * @param token Token de registro de Firebase.
   * @returns Hash SHA-256 del token.
   */
  private hashPushIdentifier(identifier: string): string {
    return createHash('sha256').update(identifier).digest('hex');
  }

  private getPushIdentifier(subscription: PushSubscriptionRecord): string {
    return subscription.fid ?? subscription.token ?? '';
  }

  /**
   * Construye la URL de la sección de gastos fijos.
   *
   * @returns URL absoluta utilizada al abrir una notificación.
   */
  private buildFixedExpensesUrl(): string {
    const appBaseUrl =
      readOptionalEnv('APP_BASE_URL') ?? 'https://cashy-cd3e6.web.app';

    return `${appBaseUrl.replace(/\/$/, '')}/fijos`;
  }

  /**
   * Obtiene la fecha actual en la zona horaria configurada para recordatorios.
   *
   * @returns Fecha con formato `YYYY-MM-DD`.
   */
  private getTodayDateKey(): string {
    return this.formatDateKeyInTimeZone(new Date(), DEFAULT_TIME_ZONE);
  }

  /**
   * Resuelve cuántos días antes deben enviarse los recordatorios.
   *
   * @returns Cantidad entera de días configurada o valor predeterminado.
   */
  private getDueSoonReminderDays(): number {
    const rawValue = Number(readOptionalEnv('DUE_SOON_REMINDER_DAYS'));

    if (!Number.isFinite(rawValue)) {
      return DEFAULT_DUE_SOON_REMINDER_DAYS;
    }

    return Math.max(0, Math.floor(rawValue));
  }

  /**
   * Formatea una fecha para una zona horaria específica.
   *
   * @param date Fecha que se debe convertir.
   * @param timeZone Zona horaria reconocida por `Intl`.
   * @returns Fecha con formato `YYYY-MM-DD`.
   */
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
      throw new Error(
        'No se pudo resolver la fecha actual en la zona horaria configurada.',
      );
    }

    return `${year}-${month}-${day}`;
  }

  /**
   * Suma una cantidad de días a una clave de fecha.
   *
   * @param dateKey Fecha base con formato `YYYY-MM-DD`.
   * @param days Cantidad de días que se deben sumar.
   * @returns Nueva clave de fecha.
   */
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

  /**
   * Calcula la diferencia de días entre dos claves de fecha.
   *
   * @param from Fecha inicial con formato `YYYY-MM-DD`.
   * @param to Fecha final con formato `YYYY-MM-DD`.
   * @returns Diferencia entera de días.
   */
  private diffDaysBetweenDateKeys(from: string, to: string): number {
    const fromDate = this.parseDateKey(from);
    const toDate = this.parseDateKey(to);

    return Math.round(
      (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000),
    );
  }

  /**
   * Convierte una clave `YYYY-MM-DD` en una fecha UTC.
   *
   * @param value Clave de fecha que se debe interpretar.
   * @returns Fecha construida en UTC.
   */
  private parseDateKey(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  /**
   * Obtiene el vencimiento más cercano entre varios gastos.
   *
   * @param items Gastos que se deben comparar.
   * @returns Fecha más próxima o `null` cuando no existe una válida.
   */
  private getEarliestDueDate(
    items: Array<{ id: string; data: FixedExpenseNotificationRecord }>,
  ): string | null {
    const dueDates = items
      .map((item) => item.data.dueDate)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
      .sort((left, right) => left.localeCompare(right));

    return dueDates[0] ?? null;
  }

  /**
   * Construye el texto del recordatorio según días y cantidad de gastos.
   *
   * @param daysUntilDue Días restantes hasta el vencimiento.
   * @param expenseCount Cantidad de gastos incluidos.
   * @returns Mensaje localizado para la notificación.
   */
  private buildDueSoonMessage(
    daysUntilDue: number,
    expenseCount: number,
  ): string {
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

  /**
   * Divide una colección en bloques compatibles con los límites de Firestore.
   *
   * @param items Elementos que se deben dividir.
   * @param size Cantidad máxima de elementos por bloque.
   * @returns Lista de bloques conservando el orden original.
   */
  private chunkArray<T>(items: Array<T>, size: number): Array<Array<T>> {
    const chunks: Array<Array<T>> = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }
}
