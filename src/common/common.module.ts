import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'node:path';
import { readOptionalEnv, readRequiredEnv } from './env';
import { EmailService } from './services/email.service';
import { FirebaseAdminService } from './services/firebase.service';

const readNumberEnv = (name: string, fallback: number): number => {
  const value = readOptionalEnv(name);

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid email environment variable: ${name}`);
  }

  return parsed;
};

@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: () => {
        const host = readRequiredEnv('MAIL_HOST');
        const user = readRequiredEnv('MAIL_USER');
        const pass = readRequiredEnv('MAIL_PASS');
        const from = readRequiredEnv('MAIL_FROM');
        const port = readNumberEnv('MAIL_PORT', 587);

        return {
          transport: {
            host,
            port,
            secure: port === 465,
            auth: {
              user,
              pass,
            },
            tls: {
              rejectUnauthorized: false,
            },
          },
          defaults: {
            from,
          },
          template: {
            dir: join(process.cwd(), 'src', 'common', 'templates'),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
      },
    }),
  ],
  providers: [EmailService, FirebaseAdminService],
  exports: [EmailService, FirebaseAdminService],
})
export class CommonModule {}
