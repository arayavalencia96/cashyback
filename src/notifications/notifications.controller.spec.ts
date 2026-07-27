jest.mock('src/common/auth/cron-auth.guard', () => ({
  CronAuthGuard: class CronAuthGuard {},
}));
jest.mock('src/common/auth/firebase-auth.guard', () => ({
  FirebaseAuthGuard: class FirebaseAuthGuard {},
}));
jest.mock('./notifications.service', () => ({
  NotificationsService: class NotificationsService {},
}));

import type { DecodedIdToken } from 'firebase-admin/auth';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  const result = { ok: true };
  const user = { uid: 'uid-1' } as DecodedIdToken;
  const notificationsServiceMock = {
    getWebConfig: jest.fn().mockReturnValue(result),
    getStatus: jest.fn().mockResolvedValue(result),
    subscribeWebPush: jest.fn().mockResolvedValue(result),
    unsubscribeWebPush: jest.fn().mockResolvedValue(result),
    processDueReminders: jest.fn().mockResolvedValue(result),
  };
  const controller = new NotificationsController(
    notificationsServiceMock as unknown as NotificationsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates notification operations to the service', async () => {
    const subscription = {
      token: 'fcm-token',
      platform: 'web' as const,
      deviceId: 'device-1',
      userAgent: 'test-agent',
    };

    expect(controller.getWebConfig()).toBe(result);
    await expect(controller.getStatus(user)).resolves.toBe(result);
    await expect(controller.subscribe(user, subscription)).resolves.toBe(
      result,
    );
    await expect(
      controller.unsubscribe(user, { token: 'fcm-token' }),
    ).resolves.toBe(result);
    await expect(controller.processDueReminders()).resolves.toBe(result);

    expect(notificationsServiceMock.getWebConfig).toHaveBeenCalledWith();
    expect(notificationsServiceMock.getStatus).toHaveBeenCalledWith('uid-1');
    expect(notificationsServiceMock.subscribeWebPush).toHaveBeenCalledWith(
      'uid-1',
      subscription,
    );
    expect(notificationsServiceMock.unsubscribeWebPush).toHaveBeenCalledWith(
      'uid-1',
      'fcm-token',
    );
    expect(notificationsServiceMock.processDueReminders).toHaveBeenCalledWith();
  });
});
