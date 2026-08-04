jest.mock('src/common/services/firebase.service', () => ({
  FirebaseAdminService: class FirebaseAdminService {},
}));

jest.mock('../common/services/email.service', () => ({
  EmailService: class EmailService {},
}));

import type { EmailService } from '../common/services/email.service';
import type { FirebaseAdminService } from '../common/services/firebase.service';
import type { BlockCodeEmailPayload } from './interfaces/user-block-code.interface';
import { UserService } from './user.service';
import { createHash } from 'node:crypto';

describe('UserService', () => {
  const getUser = jest.fn();
  const getUserByEmail = jest.fn();
  const updateUserDisabled = jest.fn();
  const updateUserPassword = jest.fn();
  const revokeRefreshTokens = jest.fn();
  const sendBlockedCodeEmail = jest.fn<
    Promise<void>,
    [BlockCodeEmailPayload]
  >();
  const sendPasswordResetEmail = jest.fn();
  const documentGet = jest.fn();
  const documentSet = jest.fn();
  const collectionAdd = jest.fn();

  const firestore = {
    collection: jest.fn(() => ({
      add: collectionAdd,
      doc: jest.fn(() => ({
        get: documentGet,
        set: documentSet,
      })),
    })),
  };

  const firebaseAdminService = {
    getUser,
    getUserByEmail,
    updateUserDisabled,
    updateUserPassword,
    revokeRefreshTokens,
    firestore,
  } as unknown as FirebaseAdminService;

  const emailService = {
    sendBlockedCodeEmail,
    sendPasswordResetEmail,
  } as unknown as EmailService;

  const service = new UserService(firebaseAdminService, emailService);

  beforeEach(() => {
    jest.clearAllMocks();
    documentSet.mockResolvedValue(undefined);
    collectionAdd.mockResolvedValue({ id: 'consent-1' });
    updateUserDisabled.mockResolvedValue(undefined);
  });

  it('records the current legal versions using the server timestamp', async () => {
    documentGet.mockResolvedValue({ exists: true, data: () => ({}) });

    const response = await service.recordLegalConsent('uid-1', 'rejected');

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      termsVersion: '2026-08-03',
      privacyVersion: '2026-08-04-v2',
      analyticsConsent: 'rejected',
    });
    expect(response.result.acceptedAt).toEqual(expect.any(String));
    expect(documentSet).toHaveBeenCalledWith(
      expect.objectContaining({ legalConsent: response.result }),
      { merge: true },
    );
    expect(collectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'uid-1',
        termsVersion: '2026-08-03',
      }),
    );
  });

  it('updates analytics consent without changing the accepted versions', async () => {
    documentGet.mockResolvedValue({
      exists: true,
      data: () => ({
        legalConsent: {
          termsVersion: '2026-08-03',
          privacyVersion: '2026-08-03',
          acceptedAt: '2026-08-03T00:00:00.000Z',
          analyticsConsent: 'rejected',
          analyticsConsentAt: '2026-08-03T00:00:00.000Z',
        },
      }),
    });

    const response = await service.updateAnalyticsConsent('uid-1', 'accepted');

    expect(response.result).toMatchObject({
      termsVersion: '2026-08-03',
      acceptedAt: '2026-08-03T00:00:00.000Z',
      analyticsConsent: 'accepted',
    });
  });

  it('blocks the user and sends a verification code', async () => {
    getUser.mockResolvedValue({
      uid: 'uid-1',
      email: 'user@cashy.app',
      displayName: 'Cashy User',
    });
    documentGet.mockResolvedValue({ exists: false });
    sendBlockedCodeEmail.mockResolvedValue(undefined);

    const response = await service.requestBlockCode('uid-1');

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      uid: 'uid-1',
      email: 'user@cashy.app',
      disabled: true,
    });
    expect(updateUserDisabled).toHaveBeenCalledWith('uid-1', true);
    const emailPayload = sendBlockedCodeEmail.mock.calls[0][0];
    expect(emailPayload.uid).toBe('uid-1');
    expect(emailPayload.email).toBe('user@cashy.app');
    expect(emailPayload.code).toMatch(/^\d{6}$/);
  });

  it('returns an unblocked status when the email is not registered', async () => {
    getUserByEmail.mockRejectedValue(new Error('User not found'));

    const response = await service.checkBlockStatusByEmail(' USER@CASHY.APP ');

    expect(response.result).toEqual({
      blocked: false,
      uid: '',
      email: 'user@cashy.app',
      disabled: false,
      codeSent: false,
    });
  });

  it('registers and resets failed login attempts', async () => {
    getUserByEmail.mockResolvedValue({ uid: 'uid-1' });
    documentGet.mockResolvedValue({ exists: false });

    const failedAttempt =
      await service.registerFailedLoginAttempt('USER@CASHY.APP');
    const reset = await service.resetLoginAttempts('user@cashy.app');

    expect(failedAttempt.result).toMatchObject({
      attemptCount: 1,
      remainingAttempts: 2,
      blocked: false,
    });
    expect(reset.result.attemptCount).toBe(0);
    expect(documentSet).toHaveBeenCalledTimes(2);
  });

  it('updates the Firebase user status', async () => {
    getUser.mockResolvedValue({ uid: 'uid-1' });
    documentGet.mockResolvedValue({ exists: false });

    const response = await service.setUserStatus('uid-1', true);

    expect(response.result).toEqual({ uid: 'uid-1', disabled: true });
    expect(updateUserDisabled).toHaveBeenCalledWith('uid-1', true);
  });
});

interface StoredDocument {
  id: string;
  data: Record<string, unknown>;
}

interface QuerySnapshotMock {
  empty: boolean;
  docs: Array<{
    id: string;
    data: () => Record<string, unknown>;
    ref: { set: (value: Record<string, unknown>) => Promise<void> };
  }>;
}

interface QueryMock {
  where: (field: string, operator: string, value: unknown) => QueryMock;
  limit: (size: number) => QueryMock;
  get: () => Promise<QuerySnapshotMock>;
  doc: (id: string) => {
    get: () => Promise<{
      id: string;
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    }>;
    set: (value: Record<string, unknown>) => Promise<void>;
  };
}

function createUserServiceHarness() {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  const getCollection = (
    name: string,
  ): Map<string, Record<string, unknown>> => {
    const existing = collections.get(name);
    if (existing) {
      return existing;
    }
    const created = new Map<string, Record<string, unknown>>();
    collections.set(name, created);
    return created;
  };
  const collection = (name: string): QueryMock => {
    const filters: Array<[string, unknown]> = [];
    const query: QueryMock = {
      where: (field: string, _operator: string, value: unknown) => {
        filters.push([field, value]);
        return query;
      },
      limit: () => query,
      get: () => {
        const documents: StoredDocument[] = Array.from(
          getCollection(name).entries(),
        )
          .map(([id, data]) => ({ id, data }))
          .filter(({ data }) =>
            filters.every(([field, value]) => data[field] === value),
          );
        return Promise.resolve({
          empty: documents.length === 0,
          docs: documents.map((document) => {
            const set = (value: Record<string, unknown>): Promise<void> => {
              getCollection(name).set(document.id, value);
              return Promise.resolve();
            };
            return {
              id: document.id,
              data: () => document.data,
              ref: { set },
            };
          }),
        });
      },
      doc: (id: string) => ({
        get: () => {
          const value = getCollection(name).get(id);
          return Promise.resolve({
            id,
            exists: value !== undefined,
            data: () => value,
          });
        },
        set: (value: Record<string, unknown>) => {
          getCollection(name).set(id, value);
          return Promise.resolve();
        },
      }),
    };
    return query;
  };
  const getUser = jest.fn();
  const getUserByEmail = jest.fn();
  const updateUserDisabled = jest.fn().mockResolvedValue({});
  const updateUserPassword = jest.fn().mockResolvedValue({});
  const revokeRefreshTokens = jest.fn().mockResolvedValue(undefined);
  const sendBlockedCodeEmail = jest.fn().mockResolvedValue(undefined);
  const sendPasswordResetEmail = jest.fn().mockResolvedValue(undefined);
  const firebase = {
    firestore: { collection },
    getUser,
    getUserByEmail,
    updateUserDisabled,
    updateUserPassword,
    revokeRefreshTokens,
  } as unknown as FirebaseAdminService;
  const email = {
    sendBlockedCodeEmail,
    sendPasswordResetEmail,
  } as unknown as EmailService;

  return {
    service: new UserService(firebase, email),
    collections,
    getCollection,
    getUser,
    getUserByEmail,
    updateUserDisabled,
    updateUserPassword,
    revokeRefreshTokens,
    sendBlockedCodeEmail,
    sendPasswordResetEmail,
  };
}

describe('UserService recovery flows', () => {
  const uid = 'uid-1';
  const email = 'user@cashy.app';
  const code = '123456';
  const hashCode = (value: string): string =>
    createHash('sha256').update(`${uid}:${value}`).digest('hex');

  const pendingBlockRecord = (): Record<string, unknown> => ({
    uid,
    email,
    codeHash: hashCode(code),
    requestedAt: new Date().toISOString(),
    requestedAtMs: Date.now(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    expiresAtMs: Date.now() + 300_000,
    status: 'pending',
    disabled: true,
    name: 'User',
    attemptCount: 0,
    updatedAt: new Date().toISOString(),
  });

  it('verifies a block code and creates a password recovery session', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({
      uid,
      email,
      displayName: 'User',
    });
    harness.getCollection('user_block_codes').set(uid, pendingBlockRecord());

    const response = await harness.service.verifyBlockCode(uid, code);

    expect(response.result).toMatchObject({
      uid,
      status: 'verified',
      resetLinkSent: true,
    });
    expect(harness.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(harness.getCollection('user_password_recovery_sessions').size).toBe(
      1,
    );
  });

  it.each(['', '12345', '1234567'])(
    'rejects malformed verification codes',
    async (invalidCode) => {
      const harness = createUserServiceHarness();

      await expect(
        harness.service.verifyBlockCode(uid, invalidCode),
      ).rejects.toThrow('Código inválido');
    },
  );

  it('rejects verification when no request exists', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid, email });

    await expect(harness.service.verifyBlockCode(uid, code)).rejects.toThrow(
      'Solicitud no encontrada',
    );
  });

  it('expires an outdated verification code', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid, email });
    harness.getCollection('user_block_codes').set(uid, {
      ...pendingBlockRecord(),
      expiresAtMs: Date.now() - 1,
    });

    await expect(harness.service.verifyBlockCode(uid, code)).rejects.toThrow(
      'Código vencido',
    );
    expect(harness.getCollection('user_block_codes').get(uid)?.status).toBe(
      'expired',
    );
  });

  it('increments attempts for an incorrect verification code', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid, email });
    harness.getCollection('user_block_codes').set(uid, pendingBlockRecord());

    await expect(
      harness.service.verifyBlockCode(uid, '654321'),
    ).rejects.toThrow('Código incorrecto');
    expect(
      harness.getCollection('user_block_codes').get(uid)?.attemptCount,
    ).toBe(1);
  });

  it('returns immediately for an already completed verification', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid, email });
    harness.getCollection('user_block_codes').set(uid, {
      ...pendingBlockRecord(),
      status: 'verified',
      disabled: false,
      passwordResetPending: false,
    });

    const response = await harness.service.verifyBlockCode(uid, code);

    expect(response.result.resetLinkSent).toBe(false);
  });

  it('keeps an already verified recovery pending while its session is active', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid, email });
    harness.getCollection('user_block_codes').set(uid, {
      ...pendingBlockRecord(),
      status: 'verified',
      disabled: false,
      passwordResetPending: true,
    });
    harness.getCollection('user_password_recovery_sessions').set('active', {
      uid,
      email,
      purpose: 'password_reset',
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const response = await harness.service.verifyBlockCode(uid, code);

    expect(response.description).toContain('sigue pendiente');
  });

  it.each([false, true])(
    'requests a new code when recovery is absent or expired',
    async (hasExpiredSession) => {
      const harness = createUserServiceHarness();
      harness.getUser.mockResolvedValue({ uid, email, displayName: '' });
      harness.getCollection('user_block_codes').set(uid, {
        ...pendingBlockRecord(),
        status: 'verified',
        disabled: false,
        passwordResetPending: true,
      });
      if (hasExpiredSession) {
        harness.getCollection('user_password_recovery_sessions').set('old', {
          uid,
          email,
          purpose: 'password_reset',
          status: 'active',
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        });
      }

      const response = await harness.service.verifyBlockCode(uid, code);

      expect(response.message).toBe('Verificacion vencida');
      expect(harness.sendBlockedCodeEmail).toHaveBeenCalledTimes(1);
    },
  );

  it('resends the password recovery email for a verified account', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid, email, displayName: null });
    harness.getCollection('user_block_codes').set(uid, {
      ...pendingBlockRecord(),
      status: 'verified',
      disabled: false,
      passwordResetPending: true,
      passwordResetResendCount: 1,
    });

    const response = await harness.service.resendPasswordResetEmail(uid);

    expect(response.result.passwordResetResendCount).toBe(2);
    expect(harness.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects resending before verification', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid, email });
    harness.getCollection('user_block_codes').set(uid, pendingBlockRecord());

    await expect(harness.service.resendPasswordResetEmail(uid)).rejects.toThrow(
      'Usuario no habilitado',
    );
  });

  it('validates email and request before resending', async () => {
    const withoutEmail = createUserServiceHarness();
    withoutEmail.getUser.mockResolvedValue({ uid });
    await expect(
      withoutEmail.service.resendPasswordResetEmail(uid),
    ).rejects.toThrow('Correo no disponible');

    const withoutRecord = createUserServiceHarness();
    withoutRecord.getUser.mockResolvedValue({ uid, email });
    await expect(
      withoutRecord.service.resendPasswordResetEmail(uid),
    ).rejects.toThrow('Solicitud no encontrada');
  });

  it('updates a password and consumes the recovery session', async () => {
    const harness = createUserServiceHarness();
    const sessionId = 'session-id';
    const sessionHash = createHash('sha256').update(sessionId).digest('hex');
    harness.getCollection('user_password_recovery_sessions').set(sessionHash, {
      uid,
      email,
      purpose: 'password_reset',
      status: 'active',
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      expiresAtMs: Date.now() + 600_000,
      updatedAt: new Date().toISOString(),
    });
    harness.getCollection('user_block_codes').set(uid, {
      ...pendingBlockRecord(),
      status: 'verified',
      passwordResetPending: true,
    });

    const response = await harness.service.updatePasswordManually(
      sessionId,
      'Password1',
    );

    expect(response.result.passwordUpdated).toBe(true);
    expect(harness.updateUserPassword).toHaveBeenCalledWith(uid, 'Password1');
    expect(harness.revokeRefreshTokens).toHaveBeenCalledWith(uid);
    expect(
      harness.getCollection('user_password_recovery_sessions').get(sessionHash)
        ?.status,
    ).toBe('consumed');
  });

  it.each([
    ['', 'Password1', 'Sesion invalida'],
    ['session', 'short', 'Contraseña invalida'],
  ])(
    'validates manual password update inputs',
    async (session, password, message) => {
      const harness = createUserServiceHarness();

      await expect(
        harness.service.updatePasswordManually(session, password),
      ).rejects.toThrow(message);
    },
  );

  it('rejects a missing password recovery session', async () => {
    const harness = createUserServiceHarness();

    await expect(
      harness.service.updatePasswordManually('missing', 'Password1'),
    ).rejects.toThrow('Solicitud no encontrada');
  });

  it.each([
    ['consumed', 'password_reset', 'Solicitud inválida'],
    ['active', 'other', 'Solicitud inválida'],
  ])('rejects unusable password sessions', async (status, purpose, message) => {
    const harness = createUserServiceHarness();
    const sessionId = `${status}-${purpose}`;
    const sessionHash = createHash('sha256').update(sessionId).digest('hex');
    harness.getCollection('user_password_recovery_sessions').set(sessionHash, {
      uid,
      email,
      purpose,
      status,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(
      harness.service.updatePasswordManually(sessionId, 'Password1'),
    ).rejects.toThrow(message);
  });

  it('expires an outdated password recovery session', async () => {
    const harness = createUserServiceHarness();
    const sessionId = 'expired-session';
    const sessionHash = createHash('sha256').update(sessionId).digest('hex');
    harness.getCollection('user_password_recovery_sessions').set(sessionHash, {
      uid,
      email,
      purpose: 'password_reset',
      status: 'active',
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });

    await expect(
      harness.service.updatePasswordManually(sessionId, 'Password1'),
    ).rejects.toThrow('Sesion vencida');
    expect(
      harness.getCollection('user_password_recovery_sessions').get(sessionHash)
        ?.status,
    ).toBe('expired');
  });

  it('returns enabled status for an active Firebase user', async () => {
    const harness = createUserServiceHarness();
    harness.getUserByEmail.mockResolvedValue({
      uid,
      email,
      disabled: false,
    });

    const response = await harness.service.checkBlockStatusByEmail(email);

    expect(response.result).toMatchObject({
      blocked: false,
      disabled: false,
      passwordResetPending: false,
    });
  });

  it('detects a password changed after the reset email was sent', async () => {
    const harness = createUserServiceHarness();
    harness.getUserByEmail.mockResolvedValue({
      uid,
      email,
      disabled: false,
      tokensValidAfterTime: '2025-06-02T00:00:00.000Z',
    });
    harness.getCollection('user_block_codes').set(uid, {
      ...pendingBlockRecord(),
      status: 'verified',
      disabled: false,
      passwordResetPending: true,
      passwordResetSentAt: '2025-06-01T00:00:00.000Z',
    });

    const response = await harness.service.checkBlockStatusByEmail(email);

    expect(response.message).toBe('Contraseña actualizada');
    expect(
      harness.getCollection('user_block_codes').get(uid)?.passwordResetPending,
    ).toBe(false);
  });

  it('reports an active password recovery as pending', async () => {
    const harness = createUserServiceHarness();
    harness.getUserByEmail.mockResolvedValue({
      uid,
      email: undefined,
      disabled: false,
    });
    harness.getCollection('user_block_codes').set(uid, {
      ...pendingBlockRecord(),
      status: 'verified',
      disabled: false,
      passwordResetPending: true,
      passwordResetSentAt: new Date().toISOString(),
    });
    harness.getCollection('user_password_recovery_sessions').set('active', {
      uid,
      email,
      purpose: 'password_reset',
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const response = await harness.service.checkBlockStatusByEmail(email);

    expect(response.result.passwordResetPending).toBe(true);
  });

  it('sends a code when Firebase reports a blocked account', async () => {
    const harness = createUserServiceHarness();
    harness.getUserByEmail.mockResolvedValue({
      uid,
      email,
      disabled: true,
    });
    harness.getUser.mockResolvedValue({ uid, email });

    const response = await harness.service.checkBlockStatusByEmail(email);

    expect(response.result).toMatchObject({
      blocked: true,
      codeSent: true,
    });
  });

  it('blocks an account at the third failed login attempt', async () => {
    const harness = createUserServiceHarness();
    harness.getUserByEmail.mockResolvedValue({ uid, email });
    harness.getUser.mockResolvedValue({ uid, email, displayName: 'User' });
    harness.getCollection('user_login_attempts').set(email, {
      uid,
      email,
      attemptCount: 2,
      blocked: false,
    });

    const response = await harness.service.registerFailedLoginAttempt(email);

    expect(response.result).toMatchObject({
      attemptCount: 3,
      blocked: true,
      codeSent: true,
    });
    expect(harness.sendBlockedCodeEmail).toHaveBeenCalledTimes(1);
  });

  it('updates a persisted block record when toggling user status', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid, email });
    harness.getCollection('user_block_codes').set(uid, pendingBlockRecord());

    await harness.service.setUserStatus(uid, false);

    expect(harness.getCollection('user_block_codes').get(uid)?.disabled).toBe(
      false,
    );
  });

  it('validates public inputs and missing Firebase users', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockRejectedValue(new Error('missing'));
    harness.getUserByEmail.mockRejectedValue(new Error('missing'));

    await expect(harness.service.requestBlockCode(uid)).rejects.toThrow(
      'Usuario no encontrado',
    );
    await expect(harness.service.checkBlockStatusByEmail('')).rejects.toThrow(
      'Correo inválido',
    );
    await expect(
      harness.service.registerFailedLoginAttempt(''),
    ).rejects.toThrow('Correo invalido');
    await expect(
      harness.service.registerFailedLoginAttempt(email),
    ).rejects.toThrow('Usuario no encontrado');
    await expect(harness.service.resetLoginAttempts('')).rejects.toThrow(
      'Correo invalido',
    );
    await expect(harness.service.resetLoginAttempts(email)).rejects.toThrow(
      'Usuario no encontrado',
    );
    await expect(
      harness.service.setUserStatus(uid, 'true' as unknown as boolean),
    ).rejects.toThrow('Estado inválido');
  });

  it('rejects requesting a block code for a user without email', async () => {
    const harness = createUserServiceHarness();
    harness.getUser.mockResolvedValue({ uid });

    await expect(harness.service.requestBlockCode(uid)).rejects.toThrow(
      'Correo no disponible',
    );
  });

  it('expires only active password-reset sessions', async () => {
    const harness = createUserServiceHarness();
    const sessions = harness.getCollection('user_password_recovery_sessions');
    sessions.set('active', {
      uid,
      status: 'active',
      purpose: 'password_reset',
    });
    sessions.set('consumed', {
      uid,
      status: 'consumed',
      purpose: 'password_reset',
    });
    sessions.set('other', {
      uid,
      status: 'active',
      purpose: 'other',
    });
    const internal = harness.service as unknown as {
      expireActivePasswordRecoverySessions: (userId: string) => Promise<void>;
    };

    await internal.expireActivePasswordRecoverySessions(uid);

    expect(sessions.get('active')?.status).toBe('expired');
    expect(sessions.get('consumed')?.status).toBe('consumed');
    expect(sessions.get('other')?.status).toBe('active');
  });

  it('covers normalization, display-name, date and password helpers', () => {
    const harness = createUserServiceHarness();
    const internal = harness.service as unknown as {
      normalizeEmail: (value: string | null | undefined) => string;
      resolveDisplayName: (
        displayName: string | null | undefined,
        emailValue: string,
      ) => string;
      parseOptionalDate: (value: string | null | undefined) => Date | null;
      isValidPassword: (value: string) => boolean;
      formatArgentinaDateTime: (value: string) => string;
    };

    expect(internal.normalizeEmail(null)).toBe('');
    expect(internal.normalizeEmail(' USER@CASHY.APP ')).toBe(email);
    expect(internal.resolveDisplayName(' User ', email)).toBe('User');
    expect(internal.resolveDisplayName('', email)).toBe('user');
    expect(internal.resolveDisplayName('', '@cashy.app')).toBe('usuario');
    expect(internal.parseOptionalDate(undefined)).toBeNull();
    expect(internal.parseOptionalDate('invalid')).toBeNull();
    expect(internal.parseOptionalDate('2025-06-01')).toBeInstanceOf(Date);
    expect(internal.isValidPassword('Password1')).toBe(true);
    expect(internal.isValidPassword('password')).toBe(false);
    expect(internal.formatArgentinaDateTime('invalid')).toBe('invalid');
  });
});
