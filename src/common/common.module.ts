import { Module } from '@nestjs/common';

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
    RateLimitStorageService,
    RateLimitGuard,
  ],
  exports: [
    BrevoService,
    EmailService,
    FirebaseAdminService,
    RateLimitStorageService,
    RateLimitGuard,
  ],
})
export class CommonModule {}
