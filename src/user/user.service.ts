import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { createHash, randomInt } from 'node:crypto';
import type { UserRecord } from 'firebase-admin/auth';

import { EmailService } from '../common/services/email.service';
import { FirebaseAdminService } from 'src/common/services/firebase.service';

import {
  ApiResponse,
  buildErrorResponse,
  buildSuccessResponse,
} from '../common/api-response';

import {
  BlockCodeEmailPayload,
  PasswordResetEmailPayload,
  ToggleUserStatusPayload,
  UserBlockCodeRecord,
} from './interfaces/user-block-code.interface';

const BLOCK_CODE_TTL_MINUTES = 5;
const BLOCK_CODE_COLLECTION = 'user_block_codes';
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

export interface ToggleUserStatusResult {
  uid: string;
  disabled: boolean;
}

export interface CheckBlockStatusResult {
  blocked: boolean;
  uid: string;
  email: string;
  disabled: boolean;
  codeSent: boolean;
  expiresAt?: string;
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
      disabled: false,
      verifiedAt: updatedAt,
      updatedAt,
    };

    await this.firebaseAdminService.updateUserDisabled(uid, false);
    await this.firebaseAdminService.firestore
      .collection(BLOCK_CODE_COLLECTION)
      .doc(uid)
      .set(verifiedRecord);

    const resetLink =
      await this.firebaseAdminService.generatePasswordResetLink(email);

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
        disabled: false,
        status: 'verified',
        resetLinkSent: true,
      },
      'Cuenta habilitada',
      'El código fue validado y se envió el enlace para cambiar la contraseña.',
      200,
    );
  }

  async checkBlockStatusByEmail(
    email: string,
  ): Promise<ApiResponse<CheckBlockStatusResult>> {
    const normalizedEmail = email?.trim();

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

    if (!blocked) {
      return buildSuccessResponse(
        {
          blocked: false,
          uid: user.uid,
          email: user.email ?? normalizedEmail,
          disabled: user.disabled,
          codeSent: false,
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
}
