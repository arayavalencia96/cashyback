jest.mock('src/common/services/firebase.service', () => ({
  FirebaseAdminService: class FirebaseAdminService {},
}));

import type { FirebaseAdminService } from 'src/common/services/firebase.service';
import type {
  FixedExpenseNotificationRecord,
  ProcessUserDueReminderInput,
  PushSubscriptionRecord,
} from './interfaces/push-notification.interface';

import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const originalVapidKey = process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const originalReminderDays = process.env.DUE_SOON_REMINDER_DAYS;

  afterEach(() => {
    if (originalVapidKey === undefined) {
      delete process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY;
    } else {
      process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY = originalVapidKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = originalBaseUrl;
    }
    if (originalReminderDays === undefined) {
      delete process.env.DUE_SOON_REMINDER_DAYS;
    } else {
      process.env.DUE_SOON_REMINDER_DAYS = originalReminderDays;
    }
    jest.restoreAllMocks();
  });

  it('returns the public web push configuration', () => {
    process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY = 'vapid-key';
    const service = new NotificationsService({} as FirebaseAdminService);

    expect(service.getWebConfig().result).toEqual({
      enabled: true,
      vapidPublicKey: 'vapid-key',
    });
  });

  it('returns the amount of active subscriptions for a user', async () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ size: 2 }),
    };
    const service = new NotificationsService({
      firestore: {
        collection: jest.fn().mockReturnValue(query),
      },
    } as unknown as FirebaseAdminService);

    const response = await service.getStatus('uid-1');

    expect(response.result.activeDeviceCount).toBe(2);
    expect(query.where).toHaveBeenCalledWith('uid', '==', 'uid-1');
    expect(query.where).toHaveBeenCalledWith('active', '==', true);
  });

  it('finishes successfully when there are no reminder candidates', async () => {
    process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY = 'vapid-key';
    const query = {
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    };
    const service = new NotificationsService({
      firestore: {
        collection: jest.fn().mockReturnValue(query),
      },
    } as unknown as FirebaseAdminService);

    const response = await service.processDueReminders();

    expect(response.result).toMatchObject({
      processedUsers: 0,
      notifiedUsers: 0,
      deliveredCount: 0,
      failedCount: 0,
    });
  });

  it('reports disabled configuration and rejects operations that require push', async () => {
    delete process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY;
    const service = new NotificationsService({} as FirebaseAdminService);
    const internal = service as unknown as {
      cleanupExpiredTechnicalRecords: jest.Mock;
    };
    internal.cleanupExpiredTechnicalRecords = jest
      .fn()
      .mockResolvedValue(undefined);

    expect(service.getWebConfig().result).toEqual({
      enabled: false,
      vapidPublicKey: null,
    });
    await expect(
      service.subscribeWebPush('uid-1', {
        fid: 'fid',
        platform: 'web',
        deviceId: 'device',
      }),
    ).rejects.toThrow('Notificaciones no configuradas');
    await expect(service.processDueReminders()).rejects.toThrow(
      'Notificaciones no configuradas',
    );
  });

  it.each([
    ['', 'device'],
    ['token', ''],
  ])('rejects incomplete subscriptions', async (fid, deviceId) => {
    process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY = 'vapid-key';
    const service = new NotificationsService({} as FirebaseAdminService);

    await expect(
      service.subscribeWebPush('uid-1', {
        fid,
        platform: 'web',
        deviceId,
      }),
    ).rejects.toThrow('Token push invalido');
  });

  it('creates a subscription and removes a previous device token', async () => {
    process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY = 'vapid-key';
    const documentSet = jest.fn().mockResolvedValue(undefined);
    const documentDelete = jest.fn().mockResolvedValue(undefined);
    const documentGet = jest.fn().mockResolvedValueOnce({
      exists: true,
      data: () => ({
        createdAt: '2025-01-01',
        lastSuccessAt: '2025-01-02',
      }),
    });
    const queryGet = jest
      .fn()
      .mockResolvedValueOnce({
        docs: [
          {
            data: () => ({
              uid: 'uid-1',
              token: 'old-token',
              deviceId: 'device-1',
              active: true,
            }),
          },
          {
            data: () => ({
              uid: 'uid-1',
              token: 'other-token',
              deviceId: 'other-device',
              active: true,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ size: 1 });
    const collection = {
      doc: jest.fn(() => ({
        get: documentGet,
        set: documentSet,
        delete: documentDelete,
      })),
      where: jest.fn().mockReturnThis(),
      get: queryGet,
    };
    const service = new NotificationsService({
      firestore: { collection: jest.fn().mockReturnValue(collection) },
    } as unknown as FirebaseAdminService);

    const response = await service.subscribeWebPush('uid-1', {
      fid: ' new-fid ',
      platform: 'web',
      deviceId: ' device-1 ',
      userAgent: ' Browser ',
    });

    expect(response.result).toEqual({
      subscribed: true,
      activeDeviceCount: 1,
    });
    expect(documentDelete).toHaveBeenCalledTimes(1);
    expect(documentSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'uid-1',
        fid: 'new-fid',
        deviceId: 'device-1',
        userAgent: 'Browser',
        createdAt: '2025-01-01',
      }),
    );
  });

  it.each([
    ['', false, 'uid-1'],
    ['token', false, 'uid-1'],
    ['token', true, 'uid-2'],
    ['token', true, 'uid-1'],
  ])(
    'handles unsubscribe ownership and missing tokens',
    async (token, exists, ownerUid) => {
      const documentDelete = jest.fn().mockResolvedValue(undefined);
      const document = {
        get: jest.fn().mockResolvedValue({
          exists,
          data: () => ({ uid: ownerUid }),
        }),
        delete: documentDelete,
      };
      const query = {
        doc: jest.fn().mockReturnValue(document),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ size: 0 }),
      };
      const service = new NotificationsService({
        firestore: { collection: jest.fn().mockReturnValue(query) },
      } as unknown as FirebaseAdminService);

      if (!token) {
        await expect(
          service.unsubscribeWebPush('uid-1', token),
        ).rejects.toThrow('Token push invalido');
        return;
      }

      const result = await service.unsubscribeWebPush('uid-1', token);
      expect(result.result.unsubscribed).toBe(true);
      expect(documentDelete).toHaveBeenCalledTimes(
        exists && ownerUid === 'uid-1' ? 1 : 0,
      );
    },
  );

  it('handles send results for successes, invalid tokens and provider failures', async () => {
    const documentSet = jest.fn().mockResolvedValue(undefined);
    const documentDelete = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationsService({
      firestore: {
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue({
            set: documentSet,
            delete: documentDelete,
          }),
        }),
      },
    } as unknown as FirebaseAdminService);
    const internal = service as unknown as {
      handleSendResponse: (
        subscriptions: PushSubscriptionRecord[],
        response: {
          responses: Array<{
            success: boolean;
            error?: { code: string };
          }>;
        },
      ) => Promise<void>;
    };
    const subscriptions = ['success', 'invalid', 'failure'].map(
      (token): PushSubscriptionRecord => ({
        uid: 'uid-1',
        token,
        platform: 'web',
        deviceId: token,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        active: true,
        lastTokenRefreshAt: '2025-01-01',
      }),
    );

    await internal.handleSendResponse(subscriptions, {
      responses: [
        { success: true },
        {
          success: false,
          error: { code: 'messaging/invalid-registration-token' },
        },
        { success: false },
        { success: true },
      ],
    });

    expect(documentDelete).toHaveBeenCalledTimes(1);
    expect(documentSet).toHaveBeenCalledTimes(2);
  });

  it('covers pending-expense, grouping, dates and message helpers', () => {
    const service = new NotificationsService({} as FirebaseAdminService);
    const internal = service as unknown as {
      isPendingExpense: (item: FixedExpenseNotificationRecord) => boolean;
      groupExpensesByUser: (
        items: Array<{
          id: string;
          data: FixedExpenseNotificationRecord;
        }>,
      ) => Map<string, unknown[]>;
      getEarliestDueDate: (
        items: Array<{
          id: string;
          data: FixedExpenseNotificationRecord;
        }>,
      ) => string | null;
      buildDueSoonMessage: (days: number, count: number) => string;
      addDaysToDateKey: (date: string, days: number) => string;
      diffDaysBetweenDateKeys: (from: string, to: string) => number;
      chunkArray: <T>(items: T[], size: number) => T[][];
      buildFixedExpensesUrl: () => string;
      getDueSoonReminderDays: () => number;
    };

    expect(internal.isPendingExpense({ dueDate: '' })).toBe(false);
    expect(
      internal.isPendingExpense({
        dueDate: '2025-06-01',
        paymentStatus: 'pending',
      }),
    ).toBe(true);
    expect(
      internal.isPendingExpense({
        dueDate: '2025-06-01',
        paymentStatus: 'paid',
      }),
    ).toBe(false);
    expect(
      internal.isPendingExpense({
        dueDate: '2025-06-01',
        partialPaymentAmount: 1,
      }),
    ).toBe(false);
    expect(
      internal.isPendingExpense({ dueDate: '2025-06-01', isPaid: true }),
    ).toBe(false);
    expect(internal.isPendingExpense({ dueDate: '2025-06-01' })).toBe(true);

    const items = [
      { id: 'invalid-user', data: { dueDate: '2025-06-01' } },
      { id: 'invalid-date', data: { userId: 'uid-1', dueDate: ' ' } },
      { id: 'later', data: { userId: 'uid-1', dueDate: '2025-06-03' } },
      { id: 'nearer', data: { userId: 'uid-1', dueDate: '2025-06-01' } },
    ];
    expect(internal.groupExpensesByUser(items).get('uid-1')).toHaveLength(2);
    expect(internal.getEarliestDueDate(items)).toBe(' ');
    expect(internal.getEarliestDueDate([])).toBeNull();
    expect(internal.buildDueSoonMessage(0, 1)).toContain('un gasto');
    expect(internal.buildDueSoonMessage(0, 2)).toContain('gastos');
    expect(internal.buildDueSoonMessage(1, 1)).toContain('1 dia');
    expect(internal.buildDueSoonMessage(2, 1)).toContain('2 dias');
    expect(internal.buildDueSoonMessage(1, 2)).toContain('vencen gastos');
    expect(internal.buildDueSoonMessage(2, 2)).toContain('2 dias');
    expect(internal.addDaysToDateKey('2025-06-30', 1)).toBe('2025-07-01');
    expect(internal.diffDaysBetweenDateKeys('2025-06-01', '2025-06-04')).toBe(
      3,
    );
    expect(internal.chunkArray([1, 2, 3], 2)).toEqual([[1, 2], [3]]);

    process.env.APP_BASE_URL = 'https://cashy.app/';
    expect(internal.buildFixedExpensesUrl()).toBe('https://cashy.app/fijos');
    delete process.env.DUE_SOON_REMINDER_DAYS;
    expect(internal.getDueSoonReminderDays()).toBe(3);
    process.env.DUE_SOON_REMINDER_DAYS = '-2.8';
    expect(internal.getDueSoonReminderDays()).toBe(0);
    process.env.DUE_SOON_REMINDER_DAYS = '2.8';
    expect(internal.getDueSoonReminderDays()).toBe(2);
  });

  it('covers user reminder skip paths', async () => {
    const service = new NotificationsService({} as FirebaseAdminService);
    const internal = service as unknown as {
      processUserDueReminder: (input: ProcessUserDueReminderInput) => Promise<{
        skippedAlreadySent: number;
        usersWithoutSubscriptions: number;
      }>;
    };
    const base: ProcessUserDueReminderInput = {
      uid: 'uid-1',
      todayKey: '2025-06-01',
      alreadySent: false,
      subscriptions: [],
      overdueItems: [],
      dueSoonItems: [],
    };

    const sent = await internal.processUserDueReminder({
      ...base,
      alreadySent: true,
    });
    const withoutDevices = await internal.processUserDueReminder(base);

    expect(sent.skippedAlreadySent).toBe(1);
    expect(withoutDevices.usersWithoutSubscriptions).toBe(1);
  });

  it('sends overdue and due-soon reminders and records successful deliveries', async () => {
    const documentSet = jest.fn().mockResolvedValue(undefined);
    const messagingSend = jest
      .fn()
      .mockResolvedValueOnce({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      })
      .mockResolvedValueOnce({
        successCount: 1,
        failureCount: 1,
        responses: [
          {
            success: false,
            error: { code: 'messaging/server-unavailable' },
          },
        ],
      })
      .mockResolvedValueOnce({
        successCount: 0,
        failureCount: 1,
        responses: [
          {
            success: false,
            error: { code: 'messaging/server-unavailable' },
          },
        ],
      });
    const service = new NotificationsService({
      firestore: {
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue({
            set: documentSet,
            delete: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      },
      messaging: { sendEach: messagingSend },
    } as unknown as FirebaseAdminService);
    const internal = service as unknown as {
      processUserDueReminder: (input: ProcessUserDueReminderInput) => Promise<{
        notifiedUsers: number;
        overdueUsers: number;
        dueSoonUsers: number;
      }>;
    };
    const subscription: PushSubscriptionRecord = {
      uid: 'uid-1',
      token: 'token',
      platform: 'web',
      deviceId: 'device',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      active: true,
      lastTokenRefreshAt: '2025-01-01',
    };
    const expense = {
      id: 'expense-1',
      data: {
        userId: 'uid-1',
        dueDate: '2025-06-02',
      },
    };
    const base: ProcessUserDueReminderInput = {
      uid: 'uid-1',
      todayKey: '2025-06-01',
      alreadySent: false,
      subscriptions: [subscription],
      overdueItems: [],
      dueSoonItems: [],
    };

    const overdue = await internal.processUserDueReminder({
      ...base,
      overdueItems: [expense],
    });
    const dueSoon = await internal.processUserDueReminder({
      ...base,
      dueSoonItems: [expense],
    });
    const failed = await internal.processUserDueReminder({
      ...base,
      dueSoonItems: [expense],
    });

    expect(overdue).toMatchObject({ notifiedUsers: 1, overdueUsers: 1 });
    expect(dueSoon).toMatchObject({ notifiedUsers: 1, dueSoonUsers: 1 });
    expect(failed.notifiedUsers).toBe(0);
    expect(documentSet).toHaveBeenCalled();
  });

  it('does not send a due-soon reminder without a valid due date', async () => {
    const service = new NotificationsService({} as FirebaseAdminService);
    const internal = service as unknown as {
      processUserDueReminder: (
        input: ProcessUserDueReminderInput,
      ) => Promise<{ notifiedUsers: number }>;
    };

    const result = await internal.processUserDueReminder({
      uid: 'uid-1',
      todayKey: '2025-06-01',
      alreadySent: false,
      subscriptions: [
        {
          uid: 'uid-1',
          token: 'token',
          platform: 'web',
          deviceId: 'device',
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
          active: true,
          lastTokenRefreshAt: '2025-01-01',
        },
      ],
      overdueItems: [],
      dueSoonItems: [],
    });

    expect(result.notifiedUsers).toBe(0);
  });

  it('queries, filters and groups Firestore notification records', async () => {
    const queryGet = jest
      .fn()
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'pending',
            data: () => ({
              userId: 'uid-1',
              dueDate: '2025-05-01',
              isPaid: false,
            }),
          },
          {
            id: 'paid',
            data: () => ({
              userId: 'uid-1',
              dueDate: '2025-05-02',
              isPaid: true,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'soon',
            data: () => ({
              userId: 'uid-1',
              dueDate: '2025-06-02',
              paymentStatus: 'pending',
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          {
            data: () => ({
              uid: 'uid-1',
              token: 'token',
              active: true,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          { data: () => ({ uid: 'uid-1' }) },
          { data: () => ({ uid: '' }) },
        ],
      });
    const query = {
      where: jest.fn().mockReturnThis(),
      get: queryGet,
    };
    const service = new NotificationsService({
      firestore: { collection: jest.fn().mockReturnValue(query) },
    } as unknown as FirebaseAdminService);
    const internal = service as unknown as {
      queryOverdueExpenses: (today: string) => Promise<unknown[]>;
      queryDueSoonExpenses: (today: string, end: string) => Promise<unknown[]>;
      listActiveSubscriptionsByUserIds: (
        users: string[],
      ) => Promise<Map<string, unknown[]>>;
      getLoggedUsersForDate: (
        users: string[],
        date: string,
      ) => Promise<Set<string>>;
    };

    expect(await internal.queryOverdueExpenses('2025-06-01')).toHaveLength(1);
    expect(
      await internal.queryDueSoonExpenses('2025-06-01', '2025-06-04'),
    ).toHaveLength(1);
    expect(
      (await internal.listActiveSubscriptionsByUserIds(['uid-1'])).get('uid-1'),
    ).toHaveLength(1);
    expect(
      await internal.getLoggedUsersForDate(['uid-1'], '2025-06-01'),
    ).toEqual(new Set(['uid-1']));
  });

  it('aggregates reminder statistics for candidate users', async () => {
    process.env.FIREBASE_WEB_PUSH_PUBLIC_KEY = 'vapid-key';
    const service = new NotificationsService({} as FirebaseAdminService);
    const internal = service as unknown as {
      queryOverdueExpenses: jest.Mock;
      queryDueSoonExpenses: jest.Mock;
      getLoggedUsersForDate: jest.Mock;
      listActiveSubscriptionsByUserIds: jest.Mock;
      processUserDueReminder: jest.Mock;
      cleanupExpiredTechnicalRecords: jest.Mock;
    };
    internal.cleanupExpiredTechnicalRecords = jest
      .fn()
      .mockResolvedValue(undefined);
    internal.queryOverdueExpenses = jest.fn().mockResolvedValue([
      {
        id: 'expense-1',
        data: { userId: 'uid-1', dueDate: '2025-06-01' },
      },
    ]);
    internal.queryDueSoonExpenses = jest.fn().mockResolvedValue([
      {
        id: 'expense-2',
        data: { userId: 'uid-2', dueDate: '2025-06-02' },
      },
    ]);
    internal.getLoggedUsersForDate = jest
      .fn()
      .mockResolvedValue(new Set(['uid-2']));
    internal.listActiveSubscriptionsByUserIds = jest
      .fn()
      .mockResolvedValue(new Map([['uid-1', []]]));
    internal.processUserDueReminder = jest
      .fn()
      .mockResolvedValueOnce({
        notifiedUsers: 1,
        overdueUsers: 1,
        dueSoonUsers: 0,
        skippedAlreadySent: 0,
        usersWithoutSubscriptions: 0,
        deliveredCount: 1,
        failedCount: 0,
      })
      .mockResolvedValueOnce({
        notifiedUsers: 0,
        overdueUsers: 0,
        dueSoonUsers: 0,
        skippedAlreadySent: 1,
        usersWithoutSubscriptions: 0,
        deliveredCount: 0,
        failedCount: 0,
      });

    const result = await service.processDueReminders();

    expect(result.result).toMatchObject({
      processedUsers: 2,
      notifiedUsers: 1,
      overdueUsers: 1,
      skippedAlreadySent: 1,
      deliveredCount: 1,
    });
  });

  it('removes only expired technical records during retention cleanup', async () => {
    const expiredReference = { path: 'user_block_codes/expired' };
    const activeReference = { path: 'user_block_codes/active' };
    const batchDelete = jest.fn();
    const batchCommit = jest.fn().mockResolvedValue(undefined);
    const collection = jest.fn((collectionName: string) => ({
      get: jest.fn().mockResolvedValue({
        docs:
          collectionName === 'user_block_codes'
            ? [
                {
                  ref: expiredReference,
                  data: () => ({ deleteAt: new Date(Date.now() - 1_000) }),
                },
                {
                  ref: activeReference,
                  data: () => ({ deleteAt: new Date(Date.now() + 60_000) }),
                },
              ]
            : [],
      }),
    }));
    const service = new NotificationsService({
      firestore: {
        collection,
        batch: jest.fn(() => ({ delete: batchDelete, commit: batchCommit })),
      },
    } as unknown as FirebaseAdminService);
    const internal = service as unknown as {
      cleanupExpiredTechnicalRecords: () => Promise<void>;
    };

    await internal.cleanupExpiredTechnicalRecords();

    expect(batchDelete).toHaveBeenCalledWith(expiredReference);
    expect(batchDelete).not.toHaveBeenCalledWith(activeReference);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });
});
