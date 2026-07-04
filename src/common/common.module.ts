import { Module } from '@nestjs/common';

import { EmailService } from './services/email.service';
import { FirebaseAdminService } from './services/firebase.service';
import { BrevoService } from './services/brevo.service';

@Module({
  providers: [BrevoService, EmailService, FirebaseAdminService],
  exports: [BrevoService, EmailService, FirebaseAdminService],
})
export class CommonModule {}
