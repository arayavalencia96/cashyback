jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(),
  getApp: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }));
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { existsSync, readFileSync } from 'node:fs';
import { FirebaseAdminService } from './firebase.service';

describe('FirebaseAdminService', () => {
  const originalCredentialsPath = process.env.FIREBASE_CREDENTIALS_PATH;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FIREBASE_CREDENTIALS_PATH = 'firebase.json';
  });

  afterAll(() => {
    if (originalCredentialsPath === undefined) {
      delete process.env.FIREBASE_CREDENTIALS_PATH;
    } else {
      process.env.FIREBASE_CREDENTIALS_PATH = originalCredentialsPath;
    }
  });

  it('reuses Firebase and delegates authentication operations', async () => {
    const app = { name: 'cashy' };
    const user = { uid: 'uid-1' };
    const auth = {
      getUser: jest.fn().mockResolvedValue(user),
      getUserByEmail: jest.fn().mockResolvedValue(user),
      updateUser: jest.fn().mockResolvedValue(user),
      revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
      generatePasswordResetLink: jest
        .fn()
        .mockResolvedValue('https://firebase.test/reset'),
    };
    const firestore = { collection: jest.fn() };
    const messaging = { send: jest.fn() };

    jest.mocked(getApps).mockReturnValue([app] as never);
    jest.mocked(getApp).mockReturnValue(app as never);
    jest.mocked(getAuth).mockReturnValue(auth as never);
    jest.mocked(getFirestore).mockReturnValue(firestore as never);
    jest.mocked(getMessaging).mockReturnValue(messaging as never);

    const service = new FirebaseAdminService();

    await expect(service.getUser('uid-1')).resolves.toBe(user);
    await expect(service.getUserByEmail('user@cashy.app')).resolves.toBe(user);
    await expect(service.updateUserDisabled('uid-1', true)).resolves.toBe(user);
    await expect(
      service.updateUserPassword('uid-1', 'Password1'),
    ).resolves.toBe(user);
    await expect(service.revokeRefreshTokens('uid-1')).resolves.toBeUndefined();
    await expect(
      service.generatePasswordResetLink('user@cashy.app'),
    ).resolves.toBe('https://firebase.test/reset');
    expect(service.firestore).toBe(firestore);
    expect(service.messaging).toBe(messaging);
    expect(service.auth).toBe(auth);
  });

  it('initializes Firebase from a valid service account', () => {
    const app = { name: 'new-cashy' };
    jest.mocked(getApps).mockReturnValue([]);
    jest.mocked(existsSync).mockReturnValue(true);
    jest.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        type: 'service_account',
        project_id: 'cashy',
        client_email: 'firebase@cashy.app',
        private_key:
          '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      }),
    );
    jest.mocked(initializeApp).mockReturnValue(app as never);

    new FirebaseAdminService();

    expect(cert).toHaveBeenCalledWith({
      projectId: 'cashy',
      clientEmail: 'firebase@cashy.app',
      privateKey:
        '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    });
  });

  it('rejects a missing credentials file', () => {
    jest.mocked(getApps).mockReturnValue([]);
    jest.mocked(existsSync).mockReturnValue(false);

    expect(() => new FirebaseAdminService()).toThrow(
      'Firebase credentials file not found',
    );
  });

  it.each([
    [{}, 'Missing or invalid fields'],
    [
      {
        type: 'service_account',
        project_id: 'cashy',
        client_email: 'firebase@cashy.app',
        private_key: 'invalid',
      },
      'private_key does not look valid',
    ],
  ])('validates service account contents', (credentials, message) => {
    jest.mocked(getApps).mockReturnValue([]);
    jest.mocked(existsSync).mockReturnValue(true);
    jest.mocked(readFileSync).mockReturnValue(JSON.stringify(credentials));

    expect(() => new FirebaseAdminService()).toThrow(message);
  });
});
