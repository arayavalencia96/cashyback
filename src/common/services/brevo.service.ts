import { Injectable } from '@nestjs/common';

import { readOptionalEnv, readRequiredEnv } from '../env';

import {
  Brevo,
  BrevoClient,
  BrevoError,
  BrevoTimeoutError,
} from '@getbrevo/brevo';

export interface TransactionalEmailInput {
  to: string;
  name?: string;
  subject: string;
  htmlContent: string;
  replyTo?: {
    email: string;
    name?: string;
  };
}

interface SenderConfig {
  email: string;
  name?: string;
}

@Injectable()
export class BrevoService {
  private readonly client: BrevoClient;
  private readonly sender: SenderConfig;

  constructor() {
    this.client = new BrevoClient({
      apiKey: readRequiredEnv('BREVO_API_KEY'),
      timeoutInSeconds: 30,
      maxRetries: 2,
    });
    this.sender = this.readSenderConfig();
  }

  async sendTransactionalEmail(input: TransactionalEmailInput): Promise<void> {
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: input.subject,
        htmlContent: input.htmlContent,
        sender: this.sender,
        to: [
          {
            email: input.to,
            name: input.name,
          },
        ],
        replyTo: input.replyTo,
      });
    } catch (error: unknown) {
      if (error instanceof Brevo.UnauthorizedError) {
        throw new Error('Brevo API key invalida o sin permisos');
      }

      if (error instanceof Brevo.TooManyRequestsError) {
        throw new Error('Brevo limito la cantidad de envios');
      }

      if (error instanceof BrevoTimeoutError) {
        throw new Error('Brevo excedio el tiempo de respuesta');
      }

      if (error instanceof BrevoError) {
        throw new Error(
          `Brevo API error ${error.statusCode}: ${error.message}`,
        );
      }

      throw error;
    }
  }

  private readSenderConfig(): SenderConfig {
    const senderEmail = readOptionalEnv('BREVO_SENDER_EMAIL');
    const senderName = readOptionalEnv('BREVO_SENDER_NAME');
    const mailFrom = readOptionalEnv('MAIL_FROM');

    if (senderEmail) {
      return {
        email: senderEmail,
        name: senderName ?? this.extractSenderName(mailFrom),
      };
    }

    if (mailFrom) {
      const parsed = this.parseMailFrom(mailFrom);

      return {
        email: parsed.email,
        name: senderName ?? parsed.name,
      };
    }

    throw new Error(
      'Missing required environment variable: BREVO_SENDER_EMAIL or MAIL_FROM',
    );
  }

  private parseMailFrom(value: string): SenderConfig {
    const normalized = value.trim().replace(/^["']|["']$/g, '');
    const match = /^(.*)<([^>]+)>$/.exec(normalized);

    if (!match) {
      return {
        email: normalized,
      };
    }

    const name = match[1]?.trim().replace(/^["']|["']$/g, '');
    const email = match[2]?.trim();

    if (!email) {
      throw new Error(`Invalid MAIL_FROM value: ${value}`);
    }

    return {
      email,
      name: name && name.length > 0 ? name : undefined,
    };
  }

  private extractSenderName(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = this.parseMailFrom(value);

    return parsed.name;
  }
}
