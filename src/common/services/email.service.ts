import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readOptionalEnv } from '../env';

import { compile } from 'handlebars';
import { BrevoService } from './brevo.service';

import {
  BlockCodeEmailPayload,
  PasswordResetEmailPayload,
} from '../../user/interfaces/user-block-code.interface';

type MailTemplateName = 'user-blocked' | 'password-reset';
const BLOCK_CODE_TTL_MINUTES = 5;
const PASSWORD_RECOVERY_SESSION_TTL_MINUTES = 10;
const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

interface BlockCodeMailContext extends BlockCodeEmailPayload {
  supportEmail: string;
  ttlMinutes: number;
  expiresAtFormatted: string;
  isResend: boolean;
}

interface PasswordResetMailContext extends PasswordResetEmailPayload {
  supportEmail: string;
  ttlMinutes: number;
  expiresAtFormatted: string;
}

@Injectable()
export class EmailService {
  private readonly supportEmail: string;
  private readonly templateDir = join(
    process.cwd(),
    'src',
    'common',
    'templates',
  );

  constructor(private readonly brevoService: BrevoService) {
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
    const expiresAt = new Date(
      Date.now() + PASSWORD_RECOVERY_SESSION_TTL_MINUTES * 60 * 1000,
    ).toISOString();

    await this.sendMail({
      to: payload.email,
      subject: 'Restablecer contrasena',
      template: 'password-reset',
      context: {
        ...payload,
        supportEmail: this.supportEmail,
        ttlMinutes: PASSWORD_RECOVERY_SESSION_TTL_MINUTES,
        expiresAtFormatted: this.formatArgentinaDateTime(expiresAt),
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
      const htmlContent = this.renderTemplate(input.template, input.context);
      const replyTo =
        this.supportEmail.length > 0
          ? {
              email: this.supportEmail,
            }
          : undefined;

      await this.brevoService.sendTransactionalEmail({
        to: input.to,
        subject: input.subject,
        htmlContent,
        name: input.context.name,
        replyTo,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al enviar el correo';

      console.error('EmailService.sendMail failed:', error);
      throw new InternalServerErrorException(message);
    }
  }

  private readSupportEmail(): string {
    const supportFromEnv =
      readOptionalEnv('MAIL_SUPPORT') ?? readOptionalEnv('MAIL_FROM');

    if (!supportFromEnv) {
      return '';
    }

    return this.extractEmailAddress(supportFromEnv);
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

  private renderTemplate(
    template: MailTemplateName,
    context: BlockCodeMailContext | PasswordResetMailContext,
  ): string {
    const templatePath = join(this.templateDir, `${template}.hbs`);
    const templateSource = readFileSync(templatePath, 'utf8');
    const compiledTemplate = compile(templateSource, {
      noEscape: true,
    });

    return compiledTemplate(context);
  }

  private extractEmailAddress(value: string): string {
    const regex = /<([^>]+)>/;
    const parsed = regex.exec(value);

    if (parsed?.[1]) {
      return parsed[1].trim();
    }

    return value.trim();
  }
}
