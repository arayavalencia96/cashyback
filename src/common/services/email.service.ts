import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { readOptionalEnv } from '../env';
import {
  BlockCodeEmailPayload,
  PasswordResetEmailPayload,
} from '../../user/interfaces/user-block-code.interface';

type MailTemplateName = 'user-blocked' | 'password-reset';
const BLOCK_CODE_TTL_MINUTES = 5;
const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

interface BlockCodeMailContext extends BlockCodeEmailPayload {
  supportEmail: string;
  ttlMinutes: number;
  expiresAtFormatted: string;
  isResend: boolean;
}

interface PasswordResetMailContext extends PasswordResetEmailPayload {
  supportEmail: string;
}

@Injectable()
export class EmailService {
  private readonly supportEmail: string;

  constructor(private readonly mailerService: MailerService) {
    this.supportEmail = this.readSupportEmail();
  }

  async sendBlockedCodeEmail(payload: BlockCodeEmailPayload): Promise<void> {
    const isResend = payload.isResend ?? false;

    await this.sendMail({
      to: payload.email,
      subject: isResend
        ? 'Nuevo codigo de desbloqueo'
        : 'Tu cuenta fue bloqueada',
      template: 'user-blocked',
      context: {
        ...payload,
        name: payload.name ?? '',
        supportEmail: this.supportEmail,
        ttlMinutes: BLOCK_CODE_TTL_MINUTES,
        expiresAtFormatted: this.formatArgentinaDateTime(payload.expiresAt),
        isResend,
      },
    });
  }

  async sendPasswordResetEmail(
    payload: PasswordResetEmailPayload,
  ): Promise<void> {
    await this.sendMail({
      to: payload.email,
      subject: 'Restablecer contrasena',
      template: 'password-reset',
      context: {
        ...payload,
        supportEmail: this.supportEmail,
      },
    });
  }

  private async sendMail(input: {
    to: string;
    subject: string;
    template: MailTemplateName;
    context: BlockCodeMailContext | PasswordResetMailContext;
  }): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: input.to,
        subject: input.subject,
        template: input.template,
        context: input.context,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al enviar el correo';

      console.error('EmailService.sendMail failed:', error);
      throw new InternalServerErrorException(message);
    }
  }

  private readSupportEmail(): string {
    return (
      readOptionalEnv('MAIL_SUPPORT') ?? readOptionalEnv('MAIL_FROM') ?? ''
    );
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
}
