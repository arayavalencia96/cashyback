jest.mock('./user.service', () => ({
  UserService: class UserService {},
}));
jest.mock('src/common/auth/firebase-auth.guard', () => ({
  FirebaseAuthGuard: class FirebaseAuthGuard {},
}));

import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  const result = { ok: true };
  const userServiceMock = {
    requestBlockCode: jest.fn().mockResolvedValue(result),
    verifyBlockCode: jest.fn().mockResolvedValue(result),
    checkBlockStatusByEmail: jest.fn().mockResolvedValue(result),
    registerFailedLoginAttempt: jest.fn().mockResolvedValue(result),
    resetLoginAttempts: jest.fn().mockResolvedValue(result),
    resendPasswordResetEmail: jest.fn().mockResolvedValue(result),
    updatePasswordManually: jest.fn().mockResolvedValue(result),
    setUserStatus: jest.fn().mockResolvedValue(result),
    deleteAccount: jest.fn().mockResolvedValue(result),
    recordLegalConsent: jest.fn().mockResolvedValue(result),
    updateAnalyticsConsent: jest.fn().mockResolvedValue(result),
  };
  const controller = new UserController(
    userServiceMock as unknown as UserService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates user operations to the service', async () => {
    await expect(controller.requestBlockCode('uid-1')).resolves.toBe(result);
    await expect(
      controller.verifyBlockCode('uid-1', { code: '123456' }),
    ).resolves.toBe(result);
    await expect(
      controller.checkBlockStatus({ email: 'user@cashy.app' }),
    ).resolves.toBe(result);
    await expect(
      controller.registerFailedLoginAttempt({ email: 'user@cashy.app' }),
    ).resolves.toBe(result);
    await expect(
      controller.resetLoginAttempts({ email: 'user@cashy.app' }),
    ).resolves.toBe(result);
    await expect(controller.resendPasswordResetEmail('uid-1')).resolves.toBe(
      result,
    );
    await expect(
      controller.updatePasswordManually({
        sessionId: 'session-1',
        newPassword: 'Secure123',
      }),
    ).resolves.toBe(result);
    await expect(
      controller.setUserStatus(
        'uid-1',
        { disabled: true },
        {
          uid: 'admin-1',
          admin: true,
        },
      ),
    ).resolves.toBe(result);
    await expect(controller.deleteAccount({ uid: 'uid-1' })).resolves.toBe(
      result,
    );
    await expect(
      controller.recordLegalConsent(
        { analyticsConsent: 'not_decided' },
        { uid: 'uid-1' },
      ),
    ).resolves.toBe(result);
    await expect(
      controller.updateAnalyticsConsent(
        { analyticsConsent: 'accepted' },
        { uid: 'uid-1' },
      ),
    ).resolves.toBe(result);

    expect(userServiceMock.requestBlockCode).toHaveBeenCalledWith('uid-1');
    expect(userServiceMock.verifyBlockCode).toHaveBeenCalledWith(
      'uid-1',
      '123456',
    );
    expect(userServiceMock.checkBlockStatusByEmail).toHaveBeenCalledWith(
      'user@cashy.app',
    );
    expect(userServiceMock.registerFailedLoginAttempt).toHaveBeenCalledWith(
      'user@cashy.app',
    );
    expect(userServiceMock.resetLoginAttempts).toHaveBeenCalledWith(
      'user@cashy.app',
    );
    expect(userServiceMock.resendPasswordResetEmail).toHaveBeenCalledWith(
      'uid-1',
    );
    expect(userServiceMock.updatePasswordManually).toHaveBeenCalledWith(
      'session-1',
      'Secure123',
    );
    expect(userServiceMock.setUserStatus).toHaveBeenCalledWith('uid-1', true);
    expect(userServiceMock.deleteAccount).toHaveBeenCalledWith('uid-1');
    expect(userServiceMock.recordLegalConsent).toHaveBeenCalledWith(
      'uid-1',
      'not_decided',
    );
    expect(userServiceMock.updateAnalyticsConsent).toHaveBeenCalledWith(
      'uid-1',
      'accepted',
    );
  });

  it.each([
    [{ token: 'legacy-token', newPassword: 'Secure123' }, 'legacy-token'],
    [{ newPassword: 'Secure123' }, ''],
  ])(
    'supports the available recovery identifier inputs',
    async (body, expected) => {
      await controller.updatePasswordManually(body);

      expect(userServiceMock.updatePasswordManually).toHaveBeenCalledWith(
        expected,
        'Secure123',
      );
    },
  );
});
