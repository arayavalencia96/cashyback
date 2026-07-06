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
} from './interfaces/user-block-code.interface';

const BLOCK_CODE_TTL_MINUTES = 5;
const PASSWORD_RECOVERY_SESSION_TTL_MINUTES = 10;
const MAX_LOGIN_ATTEMPTS = 3;
const BLOCK_CODE_COLLECTION = 'user_block_codes';
const LOGIN_ATTEMPTS_COLLECTION = 'user_login_attempts';
const PASSWORD_RECOVERY_SESSION_COLLECTION = 'user_password_recovery_sessions';
const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export interface RequestBlockCodeResult {
  uid: string;
  email: string;
  disabled: boolean;
  expiresAt: string;
}

export interface VerifyBlockCodeResult {
  uid: string;
  email: string;
  disabled: boolean;
  status: 'verified';
  resetLinkSent: boolean;
}

export interface ResendPasswordResetResult {
  uid: string;
  email: string;
  resetLinkSent: boolean;
  passwordResetResendCount: number;
}

export interface ToggleUserStatusResult {
  uid: string;
  disabled: boolean;
}

export interface RegisterLoginAttemptResult {
  uid: string;
  email: string;
  attemptCount: number;
  remainingAttempts: number;
  blocked: boolean;
  codeSent: boolean;
  expiresAt?: string;
}

export interface ResetLoginAttemptResult {
  uid: string;
  email: string;
  attemptCount: 0;
}

export interface ManualPasswordUpdateResult {
  uid: string;
  email: string;
  passwordUpdated: boolean;
  passwordChangedAt: string;
}

interface UserLoginAttemptRecord {
  email: string;
  uid: string;
  attemptCount: number;
  blocked: boolean;
  lastAttemptAt: string;
  updatedAt: string;
  blockedAt?: string;
}

interface PasswordRecoverySessionSnapshot extends PasswordRecoverySessionRecord {
  sessionIdHash: string;
}

function stripUndefinedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export interface CheckBlockStatusResult {
  blocked: boolean;
  uid: string;
  email: string;
  disabled: boolean;
  codeSent: boolean;
  expiresAt?: string;
  passwordResetPending?: boolean;
}

@Injectable()
export class UserService {
  constructor(
    private readonly firebaseAdminService: FirebaseAdminService,
    private readonly emailService: EmailService,
  ) {}

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
      const changedAt = this.getTokensValidAfterDate(user.tokensValidAfterTime);
      const sentAt = this.getRecordDate(record.passwordResetSentAt);

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

  private async findAuthUserByEmail(email: string): Promise<UserRecord | null> {
    try {
      return await this.firebaseAdminService.getUserByEmail(email);
    } catch {
      return null;
    }
  }

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

  private getTokensValidAfterDate(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  private getRecordDate(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

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

  private generateCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  private hashCode(uid: string, code: string): string {
    return createHash('sha256').update(`${uid}:${code}`).digest('hex');
  }

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

  private normalizeEmail(email: string | null | undefined): string {
    return email?.trim().toLowerCase() ?? '';
  }

  private buildPasswordRecoveryLink(sessionId: string, email: string): string {
    const frontendUrl =
      readOptionalEnv('FRONTEND_URL') ?? 'http://localhost:4200';
    const baseUrl = frontendUrl.replace(/\/+$/, '');
    const url = new URL(`${baseUrl}/set-new-password`);
    url.searchParams.set('session', sessionId);
    url.searchParams.set('email', email);

    return url.toString();
  }

  private generatePasswordRecoverySessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashPasswordRecoverySessionId(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex');
  }

  private isValidPassword(password: string): boolean {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
  }
}
