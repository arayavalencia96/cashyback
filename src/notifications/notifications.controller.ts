import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { CronAuthGuard } from 'src/common/auth/cron-auth.guard';
import { CurrentUser } from 'src/common/auth/current-user.decorator';
import { FirebaseAuthGuard } from 'src/common/auth/firebase-auth.guard';

import { SubscribePushTokenDto } from './dto/subscribe-push-token.dto';
import { UnsubscribePushTokenDto } from './dto/unsubscribe-push-token.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('web/config')
  getWebConfig() {
    return this.notificationsService.getWebConfig();
  }

  @UseGuards(FirebaseAuthGuard)
  @Get('status')
  getStatus(@CurrentUser() user: DecodedIdToken) {
    return this.notificationsService.getStatus(user.uid);
  }

  @UseGuards(FirebaseAuthGuard)
  @Post('subscribe')
  subscribe(
    @CurrentUser() user: DecodedIdToken,
    @Body() body: SubscribePushTokenDto,
  ) {
    return this.notificationsService.subscribeWebPush(user.uid, body);
  }

  @UseGuards(FirebaseAuthGuard)
  @Delete('subscribe')
  unsubscribe(
    @CurrentUser() user: DecodedIdToken,
    @Body() body: UnsubscribePushTokenDto,
  ) {
    return this.notificationsService.unsubscribeWebPush(user.uid, body.token);
  }

  @UseGuards(CronAuthGuard)
  @Post('process-due-reminders')
  processDueReminders() {
    return this.notificationsService.processDueReminders();
  }
}
