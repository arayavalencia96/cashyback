import { Injectable } from '@nestjs/common';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { getStorage, type Storage } from 'firebase-admin/storage';
import type { ServiceAccount } from 'firebase-admin';

import { readOptionalEnv, readRequiredEnv } from '../env';

@Injectable()
export class FirebaseAdminService {
  private readonly app: App;
  private readonly authService: Auth;
  private readonly firestoreService: Firestore;
  private readonly messagingService: Messaging;
  private readonly storageService: Storage;

  constructor() {
    this.app = this.initializeApp();
    this.authService = getAuth(this.app);
    this.firestoreService = getFirestore(this.app);
    this.messagingService = getMessaging(this.app);
    this.storageService = getStorage(this.app);
  }

  /**
   * Expone el cliente de Firebase Authentication inicializado.
   *
   * @returns Cliente administrativo de autenticación.
   */
  get auth(): Auth {
    return this.authService;
  }

  /**
   * Expone el cliente de Firestore inicializado.
   *
   * @returns Cliente administrativo de Firestore.
   */
  get firestore(): Firestore {
    return this.firestoreService;
  }

  /**
   * Expone el cliente de Firebase Cloud Messaging inicializado.
   *
   * @returns Cliente administrativo de mensajería.
   */
  get messaging(): Messaging {
    return this.messagingService;
  }

  /**
   * Expone el cliente administrativo de Storage.
   *
   * @returns Cliente administrativo de almacenamiento.
   */
  get storage(): Storage {
    return this.storageService;
  }

  /**
   * Elimina los archivos almacenados bajo la ruta privada de un usuario.
   *
   * @param uid Identificador del usuario propietario.
   */
  async deleteUserFiles(uid: string): Promise<void> {
    const [files] = await this.storageService
      .bucket()
      .getFiles({ prefix: `users/${uid}/` });

    await Promise.all(files.map((file) => file.delete()));
  }

  /**
   * Obtiene el identificador de base de datos configurado.
   *
   * @returns Identificador configurado o `(default)`.
   */
  get databaseId(): string {
    return readOptionalEnv('FIREBASE_DATABASE_ID') ?? '(default)';
  }

  /**
   * Obtiene un usuario de Firebase Authentication por identificador.
   *
   * @param uid Identificador del usuario.
   * @returns Registro administrativo del usuario.
   */
  async getUser(uid: string): Promise<UserRecord> {
    return this.authService.getUser(uid);
  }

  /**
   * Obtiene un usuario de Firebase Authentication por correo.
   *
   * @param email Correo asociado a la cuenta.
   * @returns Registro administrativo del usuario.
   */
  async getUserByEmail(email: string): Promise<UserRecord> {
    return this.authService.getUserByEmail(email);
  }

  /**
   * Elimina una cuenta de Firebase Authentication.
   *
   * @param uid Identificador del usuario que se debe eliminar.
   * @returns Promesa que finaliza cuando Firebase confirma la eliminación.
   */
  async deleteUser(uid: string): Promise<void> {
    await this.authService.deleteUser(uid);
  }

  /**
   * Activa o desactiva una cuenta de Firebase Authentication.
   *
   * @param uid Identificador del usuario.
   * @param disabled Estado de desactivación que se debe aplicar.
   * @returns Registro actualizado del usuario.
   */
  async updateUserDisabled(
    uid: string,
    disabled: boolean,
  ): Promise<UserRecord> {
    return this.authService.updateUser(uid, { disabled });
  }

  /**
   * Actualiza la contraseña de un usuario mediante Firebase Admin.
   *
   * @param uid Identificador del usuario.
   * @param password Nueva contraseña validada por el flujo llamador.
   * @returns Registro actualizado del usuario.
   */
  async updateUserPassword(uid: string, password: string): Promise<UserRecord> {
    return this.authService.updateUser(uid, { password });
  }

  /**
   * Revoca los refresh tokens emitidos previamente para un usuario.
   *
   * @param uid Identificador del usuario.
   */
  async revokeRefreshTokens(uid: string): Promise<void> {
    await this.authService.revokeRefreshTokens(uid);
  }

  /**
   * Genera el enlace estándar de Firebase para restablecer una contraseña.
   *
   * @param email Correo de la cuenta.
   * @returns Enlace de recuperación generado por Firebase.
   */
  async generatePasswordResetLink(email: string): Promise<string> {
    return this.authService.generatePasswordResetLink(email);
  }

  /**
   * Inicializa Firebase Admin con la cuenta de servicio configurada.
   *
   * @returns Aplicación existente o nueva instancia inicializada.
   */
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
      storageBucket:
        readOptionalEnv('FIREBASE_STORAGE_BUCKET') ??
        `${serviceAccount.project_id}.firebasestorage.app`,
    });
  }

  /**
   * Valida los campos obligatorios y la clave privada de la cuenta de servicio.
   *
   * @param serviceAccount Credenciales leídas desde el archivo configurado.
   * @param credentialsPath Ruta utilizada para reportar errores de configuración.
   * @throws Error Si faltan campos o la clave privada no tiene un formato válido.
   */
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
