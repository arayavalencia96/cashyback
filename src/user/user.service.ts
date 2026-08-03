import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { UserRecord } from 'firebase-admin/auth';

import { EmailService } from '../common/services/email.service';
import { FirebaseAdminService } from 'src/common/services/firebase.service';

import {
  ApiResponse,
  buildErrorResponse,
  buildSuccessResponse,
} from '../common/api-response';
import { readOptionalEnv } from '../common/env';

import {
  BlockCodeEmailPayload,
  PasswordResetEmailPayload,
  PasswordRecoverySessionRecord,
  ToggleUserStatusPayload,
  UserBlockCodeRecord,
  RequestBlockCodeResult,
  VerifyBlockCodeResult,
  ResendPasswordResetResult,
  ManualPasswordUpdateResult,
  RegisterLoginAttemptResult,
  UserLoginAttemptRecord,
  ResetLoginAttemptResult,
  ToggleUserStatusResult,
  PasswordRecoverySessionSnapshot,
  CheckBlockStatusResult,
} from './interfaces/user-block-code.interface';

const BLOCK_CODE_TTL_MINUTES = 5;
const PASSWORD_RECOVERY_SESSION_TTL_MINUTES = 10;
const MAX_LOGIN_ATTEMPTS = 3;
const BLOCK_CODE_COLLECTION = 'user_block_codes';
const LOGIN_ATTEMPTS_COLLECTION = 'user_login_attempts';
const PASSWORD_RECOVERY_SESSION_COLLECTION = 'user_password_recovery_sessions';
const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

function stripUndefinedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

@Injectable()
export class UserService {
  constructor(
    private readonly firebaseAdminService: FirebaseAdminService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Genera y envía un código de verificación para un usuario bloqueado.
   *
   * @param uid Identificador del usuario en Firebase Authentication.
   * @returns Estado del envío y vencimiento del código generado.
   */
  async requestBlockCode(
    uid: string,
  ): Promise<ApiResponse<RequestBlockCodeResult>> {
    const user = await this.findAuthUser(uid);
    const email = user.email;
    const existingRecord = await this.getBlockCodeRecord(uid);
    const isResend = Boolean(
      existingRecord && existingRecord.status !== 'verified',
    );

    if (!email) {
      throw new BadRequestException(
        buildErrorResponse(
          'Correo no disponible',
          'El usuario de Firebase Authentication no tiene un correo asociado.',
          400,
        ),
      );
    }

    const code = this.generateCode();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + BLOCK_CODE_TTL_MINUTES * 60 * 1000,
    );

    const displayName = this.resolveDisplayName(user.displayName, email);

    const record: UserBlockCodeRecord = {
      uid,
      email,
      codeHash: this.hashCode(uid, code),
      requestedAt: now.toISOString(),
      requestedAtMs: now.getTime(),
      expiresAt: expiresAt.toISOString(),
      expiresAtMs: expiresAt.getTime(),
      status: 'pending',
      disabled: true,
      name: displayName,
      attemptCount: 0,
      updatedAt: now.toISOString(),
    };

    await this.firebaseAdminService.updateUserDisabled(uid, true);
    await this.firebaseAdminService.firestore
      .collection(BLOCK_CODE_COLLECTION)
      .doc(uid)
      .set(record);

    const emailPayload: BlockCodeEmailPayload = {
      uid,
      email: record.email,
      code,
      requestedAt: record.requestedAt,
      name: displayName,
      expiresAt: record.expiresAt,
      isResend,
    };

    await this.emailService.sendBlockedCodeEmail(emailPayload);

    return buildSuccessResponse(
      {
        uid,
        email: record.email,
        disabled: true,
        expiresAt: this.formatArgentinaDateTime(record.expiresAt),
      },
      'Código enviado',
      'Se bloqueó la cuenta y se envió un código de 6 dígitos al correo registrado.',
      200,
    );
  }

  /**
   * Verifica el código recibido y crea una sesión para cambiar la contraseña.
   *
   * @param uid Identificador del usuario en Firebase Authentication.
   * @param code Código de verificación proporcionado por el usuario.
   * @returns Estado de la verificación y datos de recuperación habilitados.
   */
  async verifyBlockCode(
    uid: string,
    code: string,
  ): Promise<ApiResponse<VerifyBlockCodeResult>> {
    if (typeof code !== 'string' || code.trim().length !== 6) {
      throw new BadRequestException(
        buildErrorResponse(
          'Código inválido',
          'El código debe contener exactamente 6 dígitos.',
          400,
        ),
      );
    }

    const user = await this.findAuthUser(uid);
    const record = await this.getBlockCodeRecord(uid);
    const email = user.email ?? record?.email ?? '';

    if (!email) {
      throw new BadRequestException(
        buildErrorResponse(
          'Correo no disponible',
          'No se pudo resolver el correo del usuario para enviar el enlace de contraseña.',
          400,
        ),
      );
    }

    if (!record) {
      throw new NotFoundException(
        buildErrorResponse(
          'Solicitud no encontrada',
          'Primero debes solicitar un código de desbloqueo.',
          404,
        ),
      );
    }

    if (record.status === 'verified') {
      if (record.passwordResetPending) {
        const activeSession =
          await this.findActivePasswordRecoverySessionByUid(uid);

        if (
          !activeSession ||
          Date.now() > new Date(activeSession.expiresAt).getTime()
        ) {
          if (activeSession) {
            await this.markPasswordRecoverySessionExpired(activeSession);
          }

          await this.requestBlockCode(uid);

          return buildSuccessResponse(
            {
              uid,
              email,
              disabled: false,
              status: 'verified',
              resetLinkSent: false,
            },
            'Verificacion vencida',
            'La recuperacion vencio. Debes solicitar un nuevo codigo de desbloqueo.',
            200,
          );
        }

        return buildSuccessResponse(
          {
            uid,
            email,
            disabled: false,
            status: 'verified',
            resetLinkSent: false,
          },
          'Cuenta ya verificada',
          'La cuenta ya fue habilitada previamente y sigue pendiente el cambio de contrasena. Revisa tu correo para continuar.',
          200,
        );
      }

      return buildSuccessResponse(
        {
          uid,
          email,
          disabled: false,
          status: 'verified',
          resetLinkSent: false,
        },
        'Cuenta ya verificada',
        'La cuenta ya fue habilitada previamente.',
        200,
      );
    }

    const now = Date.now();

    if (now > record.expiresAtMs) {
      await this.markBlockCodeExpired(uid, record);
      throw new GoneException(
        buildErrorResponse(
          'Código vencido',
          'El código expiró. Debes solicitar uno nuevo.',
          410,
        ),
      );
    }

    if (record.codeHash !== this.hashCode(uid, code.trim())) {
      await this.incrementAttemptCount(uid, record);
      throw new BadRequestException(
        buildErrorResponse(
          'Código incorrecto',
          'El código enviado no coincide. Solicita otro si lo necesitas.',
          400,
        ),
      );
    }

    const updatedAt = new Date().toISOString();
    const verifiedRecord: UserBlockCodeRecord = {
      ...record,
      status: 'verified',
      disabled: true,
      verifiedAt: updatedAt,
      passwordResetSentAt: updatedAt,
      passwordResetResendCount: record.passwordResetResendCount ?? 1,
      passwordResetPending: true,
      updatedAt,
    };

    await this.firebaseAdminService.firestore
      .collection(BLOCK_CODE_COLLECTION)
      .doc(uid)
      .set(verifiedRecord);

    const recoverySession = await this.ensurePasswordRecoverySession(
      uid,
      email,
    );

    const resetLink = this.buildPasswordRecoveryLink(
      recoverySession.sessionId,
      email,
    );

    const resetPayload: PasswordResetEmailPayload = {
      uid,
      email,
      resetLink,
      name: this.resolveDisplayName(user.displayName, email),
    };

    await this.emailService.sendPasswordResetEmail(resetPayload);

    return buildSuccessResponse(
      {
        uid,
        email,
        disabled: true,
        status: 'verified',
        resetLinkSent: true,
      },
      'Cuenta habilitada',
      'El código fue validado y se envió el enlace para cambiar la contraseña.',
      200,
    );
  }

  /**
   * Genera una nueva sesión y reenvía el correo de recuperación.
   *
   * @param uid Identificador del usuario que completó la verificación.
   * @returns Estado del reenvío y vencimiento de la nueva sesión.
   */
  async resendPasswordResetEmail(
    uid: string,
  ): Promise<ApiResponse<ResendPasswordResetResult>> {
    const user = await this.findAuthUser(uid);
    const record = await this.getBlockCodeRecord(uid);
    const email = user.email ?? record?.email ?? '';

    if (!email) {
      throw new BadRequestException(
        buildErrorResponse(
          'Correo no disponible',
          'No se pudo resolver el correo del usuario para reenviar el enlace de contrasena.',
          400,
        ),
      );
    }

    if (!record) {
      throw new NotFoundException(
        buildErrorResponse(
          'Solicitud no encontrada',
          'Primero debes solicitar y validar un codigo de desbloqueo.',
          404,
        ),
      );
    }

    if (
      record.status !== 'verified' ||
      record.disabled ||
      !record.passwordResetPending
    ) {
      throw new BadRequestException(
        buildErrorResponse(
          'Usuario no habilitado',
          'Debes validar el codigo de desbloqueo antes de reenviar el correo de contrasena.',
          400,
        ),
      );
    }

    const recoverySession = await this.ensurePasswordRecoverySession(
      uid,
      email,
    );
    const resetLink = this.buildPasswordRecoveryLink(
      recoverySession.sessionId,
      email,
    );
    const updatedAt = new Date().toISOString();
    const resendCount = (record.passwordResetResendCount ?? 1) + 1;
    const updatedRecord: UserBlockCodeRecord = {
      ...record,
      passwordResetSentAt: updatedAt,
      passwordResetResendCount: resendCount,
      updatedAt,
    };

    await this.firebaseAdminService.firestore
      .collection(BLOCK_CODE_COLLECTION)
      .doc(uid)
      .set(updatedRecord);

    await this.emailService.sendPasswordResetEmail({
      uid,
      email,
      resetLink,
      name: this.resolveDisplayName(user.displayName, email),
    });

    return buildSuccessResponse(
      {
        uid,
        email,
        resetLinkSent: true,
        passwordResetResendCount: resendCount,
      },
      'Correo reenviado',
      'Se envio nuevamente el enlace para cambiar la contrasena.',
      200,
    );
  }

  /**
   * Cambia la contraseña mediante una sesión de recuperación activa.
   *
   * @param sessionId Identificador opaco de la sesión de recuperación.
   * @param newPassword Nueva contraseña que debe cumplir la política definida.
   * @returns Confirmación del cambio y finalización de la recuperación.
   */
  async updatePasswordManually(
    sessionId: string,
    newPassword: string,
  ): Promise<ApiResponse<ManualPasswordUpdateResult>> {
    const trimmedSessionId = sessionId?.trim();

    if (!trimmedSessionId) {
      throw new BadRequestException(
        buildErrorResponse(
          'Sesion invalida',
          'Debes enviar una sesion valida para cambiar la contrasena.',
          400,
        ),
      );
    }

    if (!this.isValidPassword(newPassword)) {
      throw new BadRequestException(
        buildErrorResponse(
          'Contraseña invalida',
          'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.',
          400,
        ),
      );
    }

    const session =
      await this.findPasswordRecoverySessionById(trimmedSessionId);

    if (!session) {
      throw new NotFoundException(
        buildErrorResponse(
          'Solicitud no encontrada',
          'No existe una solicitud activa de cambio de contraseña.',
          404,
        ),
      );
    }

    if (session.status !== 'active' || session.purpose !== 'password_reset') {
      throw new BadRequestException(
        buildErrorResponse(
          'Solicitud inválida',
          'Debes verificar el código antes de cambiar la contraseña.',
          400,
        ),
      );
    }

    if (Date.now() > new Date(session.expiresAt).getTime()) {
      await this.markPasswordRecoverySessionExpired(session);
      throw new GoneException(
        buildErrorResponse(
          'Sesion vencida',
          'La sesion de cambio de contrasena vencio. Solicita una nueva.',
          410,
        ),
      );
    }

    await this.firebaseAdminService.updateUserPassword(
      session.uid,
      newPassword,
    );
    await this.firebaseAdminService.revokeRefreshTokens(session.uid);

    const passwordChangedAt = new Date().toISOString();
    const record = await this.getBlockCodeRecord(session.uid);

    if (record) {
      const updatedRecord: UserBlockCodeRecord = {
        ...record,
        passwordResetPending: false,
        disabled: false,
        passwordChangedAt,
        updatedAt: passwordChangedAt,
      };

      await this.firebaseAdminService.firestore
        .collection(BLOCK_CODE_COLLECTION)
        .doc(session.uid)
        .set(stripUndefinedFields(updatedRecord));
    }

    await this.firebaseAdminService.updateUserDisabled(session.uid, false);
    await this.consumePasswordRecoverySession(session, passwordChangedAt);

    return buildSuccessResponse(
      {
        uid: session.uid,
        email: session.email,
        passwordUpdated: true,
        passwordChangedAt,
      },
      'Contraseña actualizada',
      'La contraseña se cambio correctamente desde el frontend.',
      200,
    );
  }

  /**
   * Consulta por correo el bloqueo, los intentos y la recuperación de una cuenta.
   *
   * @param email Correo de la cuenta que se debe consultar.
   * @returns Estado público necesario para decidir el flujo de autenticación.
   */
  async checkBlockStatusByEmail(
    email: string,
  ): Promise<ApiResponse<CheckBlockStatusResult>> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      throw new BadRequestException(
        buildErrorResponse(
          'Correo inválido',
          'Debes enviar un correo válido para consultar el bloqueo.',
          400,
        ),
      );
    }

    const user = await this.findAuthUserByEmail(normalizedEmail);

    if (!user) {
      return buildSuccessResponse(
        {
          blocked: false,
          uid: '',
          email: normalizedEmail,
          disabled: false,
          codeSent: false,
        },
        'Usuario no bloqueado',
        'No existe un usuario registrado con ese correo en Firebase Authentication.',
        200,
      );
    }

    const record = await this.getBlockCodeRecord(user.uid);
    const blocked =
      user.disabled ||
      Boolean(record?.disabled && record.status !== 'verified');
    const passwordResetPending = Boolean(
      record?.passwordResetPending &&
      record.status === 'verified' &&
      !record.disabled,
    );

    if (passwordResetPending && record) {
      const changedAt = this.parseOptionalDate(user.tokensValidAfterTime);
      const sentAt = this.parseOptionalDate(record.passwordResetSentAt);

      if (changedAt && sentAt && changedAt > sentAt) {
        const updatedAt = changedAt.toISOString();
        const updatedRecord: UserBlockCodeRecord = {
          ...record,
          passwordResetPending: false,
          passwordChangedAt: updatedAt,
          updatedAt,
        };

        await this.firebaseAdminService.firestore
          .collection(BLOCK_CODE_COLLECTION)
          .doc(user.uid)
          .set(stripUndefinedFields(updatedRecord));
        await this.expireActivePasswordRecoverySessions(user.uid);

        return buildSuccessResponse(
          {
            blocked: false,
            uid: user.uid,
            email: user.email ?? normalizedEmail,
            disabled: user.disabled,
            codeSent: false,
            passwordResetPending: false,
          },
          'Contraseña actualizada',
          'Se detectó que la contraseña ya fue cambiada y la cuenta puede ingresar.',
          200,
        );
      }

      const activeSession = await this.findActivePasswordRecoverySessionByUid(
        user.uid,
      );

      if (
        !activeSession ||
        Date.now() > new Date(activeSession.expiresAt).getTime()
      ) {
        if (activeSession) {
          await this.markPasswordRecoverySessionExpired(activeSession);
        }

        const blockCodeResponse = await this.requestBlockCode(user.uid);

        return buildSuccessResponse(
          {
            blocked: true,
            uid: user.uid,
            email: user.email ?? normalizedEmail,
            disabled: true,
            codeSent: true,
            expiresAt: blockCodeResponse.result.expiresAt,
          },
          'Codigo requerido',
          'La recuperacion vencio. Debes validar un nuevo codigo de desbloqueo.',
          200,
        );
      }

      return buildSuccessResponse(
        {
          blocked: false,
          uid: user.uid,
          email: user.email ?? normalizedEmail,
          disabled: user.disabled,
          codeSent: false,
          passwordResetPending: true,
        },
        'Contraseña pendiente',
        'La cuenta ya fue desbloqueada, pero falta cambiar la contraseña. Revisa tu correo para continuar.',
        200,
      );
    }

    if (!blocked) {
      return buildSuccessResponse(
        {
          blocked: false,
          uid: user.uid,
          email: user.email ?? normalizedEmail,
          disabled: user.disabled,
          codeSent: false,
          passwordResetPending: false,
        },
        'Usuario habilitado',
        'El usuario no está bloqueado y puede continuar con el inicio de sesión.',
        200,
      );
    }

    const blockCodeResponse = await this.requestBlockCode(user.uid);

    return buildSuccessResponse(
      {
        blocked: true,
        uid: user.uid,
        email: user.email ?? normalizedEmail,
        disabled: true,
        codeSent: true,
        expiresAt: blockCodeResponse.result.expiresAt,
      },
      'Usuario bloqueado',
      'Se detectó la cuenta bloqueada y se reenviò un nuevo código de desbloqueo.',
      200,
    );
  }

  /**
   * Registra un intento fallido y bloquea la cuenta al alcanzar el límite.
   *
   * @param email Correo normalizado de la cuenta.
   * @returns Cantidad de intentos y estado de bloqueo resultante.
   */
  async registerFailedLoginAttempt(
    email: string,
  ): Promise<ApiResponse<RegisterLoginAttemptResult>> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      throw new BadRequestException(
        buildErrorResponse(
          'Correo invalido',
          'Debes enviar un correo valido para registrar el intento fallido.',
          400,
        ),
      );
    }

    const user = await this.findAuthUserByEmail(normalizedEmail);

    if (!user) {
      throw new NotFoundException(
        buildErrorResponse(
          'Usuario no encontrado',
          'No existe un usuario registrado con ese correo en Firebase Authentication.',
          404,
        ),
      );
    }

    const now = new Date().toISOString();
    const record = await this.getLoginAttemptRecord(normalizedEmail);
    const attemptCount = (record?.attemptCount ?? 0) + 1;
    const blocked = attemptCount >= MAX_LOGIN_ATTEMPTS;
    const nextRecord: UserLoginAttemptRecord = {
      email: normalizedEmail,
      uid: user.uid,
      attemptCount,
      blocked,
      lastAttemptAt: now,
      updatedAt: now,
      ...(blocked ? { blockedAt: now } : {}),
    };

    await this.firebaseAdminService.firestore
      .collection(LOGIN_ATTEMPTS_COLLECTION)
      .doc(normalizedEmail)
      .set(nextRecord);

    if (blocked) {
      const blockCodeResponse = await this.requestBlockCode(user.uid);

      return buildSuccessResponse(
        {
          uid: user.uid,
          email: normalizedEmail,
          attemptCount,
          remainingAttempts: 0,
          blocked: true,
          codeSent: true,
          expiresAt: blockCodeResponse.result.expiresAt,
        },
        'Usuario bloqueado',
        'Se supero el limite de intentos fallidos y se envio un nuevo codigo de desbloqueo.',
        200,
      );
    }

    return buildSuccessResponse(
      {
        uid: user.uid,
        email: normalizedEmail,
        attemptCount,
        remainingAttempts: MAX_LOGIN_ATTEMPTS - attemptCount,
        blocked: false,
        codeSent: false,
      },
      'Intento registrado',
      `Te quedan ${MAX_LOGIN_ATTEMPTS - attemptCount} intento${MAX_LOGIN_ATTEMPTS - attemptCount === 1 ? '' : 's'}.`,
      200,
    );
  }

  /**
   * Reinicia el contador de intentos fallidos de una cuenta.
   *
   * @param email Correo de la cuenta autenticada correctamente.
   * @returns Estado actualizado del contador de intentos.
   */
  async resetLoginAttempts(
    email: string,
  ): Promise<ApiResponse<ResetLoginAttemptResult>> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      throw new BadRequestException(
        buildErrorResponse(
          'Correo invalido',
          'Debes enviar un correo valido para resetear los intentos.',
          400,
        ),
      );
    }

    const user = await this.findAuthUserByEmail(normalizedEmail);

    if (!user) {
      throw new NotFoundException(
        buildErrorResponse(
          'Usuario no encontrado',
          'No existe un usuario registrado con ese correo en Firebase Authentication.',
          404,
        ),
      );
    }

    const clearedRecord: UserLoginAttemptRecord = {
      email: normalizedEmail,
      uid: user.uid,
      attemptCount: 0,
      blocked: false,
      lastAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.firebaseAdminService.firestore
      .collection(LOGIN_ATTEMPTS_COLLECTION)
      .doc(normalizedEmail)
      .set(clearedRecord);

    return buildSuccessResponse(
      {
        uid: user.uid,
        email: normalizedEmail,
        attemptCount: 0,
      },
      'Intentos reiniciados',
      'El contador de intentos fallidos quedo en cero.',
      200,
    );
  }

  /**
   * Activa o desactiva una cuenta y sincroniza su registro de bloqueo.
   *
   * @param uid Identificador del usuario en Firebase Authentication.
   * @param disabled Estado de desactivación que se debe aplicar.
   * @returns Estado final de la cuenta.
   */
  async setUserStatus(
    uid: string,
    disabled: boolean,
  ): Promise<ApiResponse<ToggleUserStatusResult>> {
    if (typeof disabled !== 'boolean') {
      throw new BadRequestException(
        buildErrorResponse(
          'Estado inválido',
          'El campo disabled debe ser boolean.',
          400,
        ),
      );
    }

    await this.findAuthUser(uid);
    await this.firebaseAdminService.updateUserDisabled(uid, disabled);
    const record = await this.getBlockCodeRecord(uid);

    if (record) {
      await this.firebaseAdminService.firestore
        .collection(BLOCK_CODE_COLLECTION)
        .doc(uid)
        .set({
          ...record,
          disabled,
          updatedAt: new Date().toISOString(),
        });
    }

    const payload: ToggleUserStatusPayload = {
      uid,
      disabled,
    };

    return buildSuccessResponse(
      payload,
      disabled ? 'Cuenta deshabilitada' : 'Cuenta habilitada',
      disabled
        ? 'La cuenta quedó deshabilitada manualmente.'
        : 'La cuenta quedó habilitada manualmente.',
      200,
    );
  }

  /**
   * Elimina todos los datos persistidos de un usuario y su cuenta de Authentication.
   *
   * @param uid Identificador del usuario autenticado.
   * @returns Confirmación de eliminación completa.
   */
  async deleteAccount(uid: string): Promise<ApiResponse<{ deleted: true }>> {
    const user = await this.findAuthUser(uid);
    const email = user.email?.trim().toLowerCase();

    const userCollections = [
      'monthlyBudgets',
      'fixedExpenses',
      'variableExpenses',
      'investments',
      'expenses',
    ];

    await Promise.all(
      userCollections.map((collectionName) =>
        this.deleteDocumentsByField(collectionName, 'userId', uid),
      ),
    );

    await Promise.all([
      this.deleteDocumentsByField('user_push_subscriptions', 'uid', uid),
      this.deleteDocumentsByField('due_reminder_notification_log', 'uid', uid),
      this.deleteDocumentsByField(
        PASSWORD_RECOVERY_SESSION_COLLECTION,
        'uid',
        uid,
      ),
      this.firebaseAdminService.firestore
        .collection(BLOCK_CODE_COLLECTION)
        .doc(uid)
        .delete(),
      ...(email
        ? [
            this.firebaseAdminService.firestore
              .collection(LOGIN_ATTEMPTS_COLLECTION)
              .doc(email)
              .delete(),
          ]
        : []),
      this.firebaseAdminService.firestore.collection('users').doc(uid).delete(),
      this.firebaseAdminService.deleteUserFiles(uid),
    ]);

    await this.firebaseAdminService.deleteUser(uid);

    return buildSuccessResponse(
      { deleted: true },
      'Cuenta eliminada',
      'La cuenta y los datos asociados fueron eliminados correctamente.',
      200,
    );
  }

  private async deleteDocumentsByField(
    collectionName: string,
    field: string,
    value: string,
  ): Promise<void> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(collectionName)
      .where(field, '==', value)
      .get();

    const batchSize = 400;

    for (let index = 0; index < snapshot.docs.length; index += batchSize) {
      const batch = this.firebaseAdminService.firestore.batch();
      snapshot.docs
        .slice(index, index + batchSize)
        .forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }

  /**
   * Busca un usuario de Firebase Authentication por identificador.
   *
   * @param uid Identificador del usuario.
   * @returns Registro de Firebase o `null` cuando no existe.
   */
  private async findAuthUser(uid: string) {
    try {
      return await this.firebaseAdminService.getUser(uid);
    } catch {
      throw new NotFoundException(
        buildErrorResponse(
          'Usuario no encontrado',
          'No existe un usuario con ese UID en Firebase Authentication.',
          404,
        ),
      );
    }
  }

  /**
   * Busca un usuario de Firebase Authentication por correo.
   *
   * @param email Correo normalizado de la cuenta.
   * @returns Registro de Firebase o `null` cuando no existe.
   */
  private async findAuthUserByEmail(email: string): Promise<UserRecord | null> {
    try {
      return await this.firebaseAdminService.getUserByEmail(email);
    } catch {
      return null;
    }
  }

  /**
   * Obtiene el registro de código y bloqueo de un usuario.
   *
   * @param uid Identificador del usuario.
   * @returns Registro persistido o `null` cuando no existe.
   */
  private async getBlockCodeRecord(
    uid: string,
  ): Promise<UserBlockCodeRecord | null> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(BLOCK_CODE_COLLECTION)
      .doc(uid)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as UserBlockCodeRecord;
  }

  /**
   * Obtiene el registro de intentos de inicio de sesión de un correo.
   *
   * @param email Correo normalizado usado como identificador.
   * @returns Registro de intentos o `null` cuando no existe.
   */
  private async getLoginAttemptRecord(
    email: string,
  ): Promise<UserLoginAttemptRecord | null> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(LOGIN_ATTEMPTS_COLLECTION)
      .doc(email)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as UserLoginAttemptRecord;
  }

  /**
   * Busca una sesión de recuperación mediante su identificador sin exponerlo.
   *
   * @param sessionId Identificador opaco recibido del cliente.
   * @returns Sesión persistida junto con su hash o `null`.
   */
  private async findPasswordRecoverySessionById(
    sessionId: string,
  ): Promise<PasswordRecoverySessionSnapshot | null> {
    const sessionIdHash = this.hashPasswordRecoverySessionId(sessionId);
    const snapshot = await this.firebaseAdminService.firestore
      .collection(PASSWORD_RECOVERY_SESSION_COLLECTION)
      .doc(sessionIdHash)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return {
      sessionIdHash: snapshot.id,
      ...(snapshot.data() as PasswordRecoverySessionRecord),
    };
  }

  /**
   * Busca una sesión de recuperación activa para un usuario.
   *
   * @param uid Identificador del usuario.
   * @returns Primera sesión activa encontrada o `null`.
   */
  private async findActivePasswordRecoverySessionByUid(
    uid: string,
  ): Promise<PasswordRecoverySessionSnapshot | null> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(PASSWORD_RECOVERY_SESSION_COLLECTION)
      .where('uid', '==', uid)
      .where('status', '==', 'active')
      .where('purpose', '==', 'password_reset')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const data = snapshot.docs[0].data() as PasswordRecoverySessionRecord;

    return {
      sessionIdHash: snapshot.docs[0].id,
      ...data,
    };
  }

  /**
   * Expira sesiones anteriores y crea una nueva sesión de recuperación.
   *
   * @param uid Identificador del usuario.
   * @param email Correo asociado a la recuperación.
   * @returns Identificador de sesión y fecha de vencimiento.
   */
  private async ensurePasswordRecoverySession(
    uid: string,
    email: string,
  ): Promise<{ sessionId: string; expiresAt: string }> {
    await this.expireActivePasswordRecoverySessions(uid);

    const sessionId = this.generatePasswordRecoverySessionId();
    const sessionIdHash = this.hashPasswordRecoverySessionId(sessionId);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + PASSWORD_RECOVERY_SESSION_TTL_MINUTES * 60 * 1000,
    ).toISOString();
    const record: PasswordRecoverySessionRecord = {
      uid,
      email,
      purpose: 'password_reset',
      status: 'active',
      createdAt,
      createdAtMs: Date.now(),
      expiresAt,
      expiresAtMs: new Date(expiresAt).getTime(),
      updatedAt: createdAt,
    };

    await this.firebaseAdminService.firestore
      .collection(PASSWORD_RECOVERY_SESSION_COLLECTION)
      .doc(sessionIdHash)
      .set(record);

    return {
      sessionId,
      expiresAt,
    };
  }

  /**
   * Marca como expiradas las sesiones de recuperación activas de un usuario.
   *
   * @param uid Identificador del usuario cuyas sesiones deben invalidarse.
   */
  private async expireActivePasswordRecoverySessions(
    uid: string,
  ): Promise<void> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(PASSWORD_RECOVERY_SESSION_COLLECTION)
      .where('uid', '==', uid)
      .get();

    if (snapshot.empty) {
      return;
    }

    const expiredAt = new Date().toISOString();
    await Promise.all(
      snapshot.docs.map(async (doc) => {
        const session = doc.data() as PasswordRecoverySessionRecord;

        if (
          session.status !== 'active' ||
          session.purpose !== 'password_reset'
        ) {
          return;
        }

        await doc.ref.set({
          ...session,
          status: 'expired',
          updatedAt: expiredAt,
        });
      }),
    );
  }

  /**
   * Marca una sesión como consumida después del cambio de contraseña.
   *
   * @param session Sesión utilizada para autorizar el cambio.
   * @param passwordChangedAt Fecha efectiva del cambio.
   */
  private async consumePasswordRecoverySession(
    session: PasswordRecoverySessionSnapshot,
    passwordChangedAt: string,
  ): Promise<void> {
    await this.firebaseAdminService.firestore
      .collection(PASSWORD_RECOVERY_SESSION_COLLECTION)
      .doc(session.sessionIdHash)
      .set({
        ...session,
        status: 'consumed',
        usedAt: passwordChangedAt,
        passwordChangedAt,
        updatedAt: passwordChangedAt,
      });
  }

  /**
   * Marca una sesión de recuperación específica como expirada.
   *
   * @param session Sesión que ya no debe aceptarse.
   */
  private async markPasswordRecoverySessionExpired(
    session: PasswordRecoverySessionSnapshot,
  ): Promise<void> {
    await this.firebaseAdminService.firestore
      .collection(PASSWORD_RECOVERY_SESSION_COLLECTION)
      .doc(session.sessionIdHash)
      .set({
        ...session,
        status: 'expired',
        updatedAt: new Date().toISOString(),
      });
  }

  /**
   * Convierte una fecha opcional a un objeto Date válido.
   *
   * @param value Fecha serializada que se debe interpretar.
   * @returns Fecha válida o `null` si está ausente o es inválida.
   */
  private parseOptionalDate(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * Marca como expirado un código de verificación persistido.
   *
   * @param uid Identificador del usuario propietario.
   * @param record Registro de código que se debe actualizar.
   */
  private async markBlockCodeExpired(
    uid: string,
    record: UserBlockCodeRecord,
  ): Promise<void> {
    const expiredRecord: UserBlockCodeRecord = {
      ...record,
      status: 'expired',
      updatedAt: new Date().toISOString(),
    };

    await this.firebaseAdminService.firestore
      .collection(BLOCK_CODE_COLLECTION)
      .doc(uid)
      .set(expiredRecord);
  }

  /**
   * Incrementa y persiste los intentos fallidos de verificación de un código.
   *
   * @param uid Identificador del usuario.
   * @param record Registro actual del código.
   */
  private async incrementAttemptCount(
    uid: string,
    record: UserBlockCodeRecord,
  ): Promise<void> {
    const nextRecord: UserBlockCodeRecord = {
      ...record,
      attemptCount: record.attemptCount + 1,
      updatedAt: new Date().toISOString(),
    };

    await this.firebaseAdminService.firestore
      .collection(BLOCK_CODE_COLLECTION)
      .doc(uid)
      .set(nextRecord);
  }

  /**
   * Genera un código numérico criptográficamente aleatorio.
   *
   * @returns Código de verificación de seis dígitos.
   */
  private generateCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  /**
   * Genera el hash de un código ligado a su usuario.
   *
   * @param uid Identificador del usuario.
   * @param code Código de verificación en texto plano.
   * @returns Hash SHA-256 utilizado para la comparación segura.
   */
  private hashCode(uid: string, code: string): string {
    return createHash('sha256').update(`${uid}:${code}`).digest('hex');
  }

  /**
   * Formatea una fecha para mostrarla en la zona horaria argentina.
   *
   * @param value Fecha ISO que se debe representar.
   * @returns Fecha y hora localizadas para Argentina.
   */
  private formatArgentinaDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    const parts = new Intl.DateTimeFormat('es-AR', {
      timeZone: ARGENTINA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const getPart = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? '';

    return `${getPart('day')}/${getPart('month')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
  }

  /**
   * Resuelve el nombre visible más adecuado para personalizar mensajes.
   *
   * @param displayName Nombre registrado en Firebase Authentication.
   * @param email Correo utilizado como alternativa.
   * @returns Nombre visible o identificador derivado del correo.
   */
  private resolveDisplayName(
    displayName: string | null | undefined,
    email: string,
  ): string {
    const trimmedDisplayName = displayName?.trim();

    if (trimmedDisplayName) {
      return trimmedDisplayName;
    }

    const emailPrefix = email.split('@')[0]?.trim();

    return emailPrefix && emailPrefix.length > 0 ? emailPrefix : 'usuario';
  }

  /**
   * Normaliza un correo para consultas e identificadores consistentes.
   *
   * @param email Correo opcional que se debe normalizar.
   * @returns Correo sin espacios y en minúsculas.
   */
  private normalizeEmail(email: string | null | undefined): string {
    return email?.trim().toLowerCase() ?? '';
  }

  /**
   * Construye el enlace del frontend para completar la recuperación.
   *
   * @param sessionId Identificador opaco de la sesión.
   * @param email Correo asociado a la cuenta.
   * @returns URL absoluta con los parámetros de recuperación.
   */
  private buildPasswordRecoveryLink(sessionId: string, email: string): string {
    const frontendUrl =
      readOptionalEnv('FRONTEND_URL') ?? 'http://localhost:4200';
    const baseUrl = frontendUrl.replace(/\/$/, '');
    const url = new URL(`${baseUrl}/set-new-password`);
    url.searchParams.set('session', sessionId);
    url.searchParams.set('email', email);

    return url.toString();
  }

  /**
   * Genera un identificador seguro para una sesión de recuperación.
   *
   * @returns Identificador aleatorio codificado para URL.
   */
  private generatePasswordRecoverySessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Genera el identificador persistente de una sesión de recuperación.
   *
   * @param sessionId Identificador opaco entregado al cliente.
   * @returns Hash SHA-256 que se almacena en Firestore.
   */
  private hashPasswordRecoverySessionId(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex');
  }

  /**
   * Comprueba que una contraseña cumpla la política mínima de seguridad.
   *
   * @param password Contraseña que se debe validar.
   * @returns `true` cuando cumple todos los requisitos.
   */
  private isValidPassword(password: string): boolean {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
  }
}
