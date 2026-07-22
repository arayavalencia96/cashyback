import { Module } from '@nestjs/common';

import { CronAuthGuard } from './auth/cron-auth.guard';
import { FirebaseAuthGuard } from './auth/firebase-auth.guard';
import { EmailService } from './services/email.service';
import { FirebaseAdminService } from './services/firebase.service';
import { BrevoService } from './services/brevo.service';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitStorageService } from './rate-limit/rate-limit.storage';

@Module({
  providers: [
    BrevoService,
    EmailService,
    FirebaseAdminService,
    CronAuthGuard,
    FirebaseAuthGuard,
    RateLimitStorageService,
    RateLimitGuard,
  ],
  exports: [
    BrevoService,
    EmailService,
    FirebaseAdminService,
    CronAuthGuard,
    FirebaseAuthGuard,
    RateLimitStorageService,
    RateLimitGuard,
  ],
})
export class CommonModule {}
