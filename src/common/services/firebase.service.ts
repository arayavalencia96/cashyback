import { Injectable } from '@nestjs/common';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { ServiceAccount } from 'firebase-admin';

import { readOptionalEnv, readRequiredEnv } from '../env';

@Injectable()
export class FirebaseAdminService {
  private readonly app: App;
  private readonly authService: Auth;
  private readonly firestoreService: Firestore;

  constructor() {
    this.app = this.initializeApp();
    this.authService = getAuth(this.app);
    this.firestoreService = getFirestore(this.app);
  }

  get auth(): Auth {
    return this.authService;
  }

  get firestore(): Firestore {
    return this.firestoreService;
  }

  get databaseId(): string {
    return readOptionalEnv('FIREBASE_DATABASE_ID') ?? '(default)';
  }

  async getUser(uid: string): Promise<UserRecord> {
    return this.authService.getUser(uid);
  }

  async updateUserDisabled(
    uid: string,
    disabled: boolean,
  ): Promise<UserRecord> {
    return this.authService.updateUser(uid, { disabled });
  }

  async generatePasswordResetLink(email: string): Promise<string> {
    return this.authService.generatePasswordResetLink(email);
  }

  private initializeApp(): App {
    if (getApps().length > 0) {
      return getApp();
    }

    const credentialsPath = resolve(
      process.cwd(),
      readRequiredEnv('FIREBASE_CREDENTIALS_PATH'),
    );

    if (!existsSync(credentialsPath)) {
      throw new Error(
        `Firebase credentials file not found at: ${credentialsPath}`,
      );
    }

    const serviceAccount = JSON.parse(
      readFileSync(credentialsPath, 'utf8'),
    ) as Partial<ServiceAccount> & {
      type?: string;
      project_id?: string;
      private_key?: string;
      client_email?: string;
    };

    this.validateServiceAccount(serviceAccount, credentialsPath);

    return initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key,
      }),
    });
  }

  private validateServiceAccount(
    serviceAccount: Partial<ServiceAccount> & {
      type?: string;
      project_id?: string;
      private_key?: string;
      client_email?: string;
    },
    credentialsPath: string,
  ): void {
    const missingFields = [
      serviceAccount.type === 'service_account' ? undefined : 'type',
      serviceAccount.project_id ? undefined : 'project_id',
      serviceAccount.private_key ? undefined : 'private_key',
      serviceAccount.client_email ? undefined : 'client_email',
    ].filter((field): field is string => Boolean(field));

    if (missingFields.length > 0) {
      throw new Error(
        `Invalid Firebase service account file at ${credentialsPath}. Missing or invalid fields: ${missingFields.join(', ')}`,
      );
    }

    if (
      !serviceAccount.private_key?.includes('BEGIN PRIVATE KEY') ||
      !serviceAccount.private_key?.includes('END PRIVATE KEY')
    ) {
      throw new Error(
        `Invalid Firebase service account file at ${credentialsPath}. private_key does not look valid.`,
      );
    }
  }
}
