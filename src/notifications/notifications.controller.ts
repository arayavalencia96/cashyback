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

  /**
   * Obtiene la configuración pública necesaria para las notificaciones web.
   */
  @Get('web/config')
  getWebConfig() {
    return this.notificationsService.getWebConfig();
  }

  /**
   * Consulta el estado de las notificaciones del usuario autenticado.
   */
  @UseGuards(FirebaseAuthGuard)
  @Get('status')
  getStatus(@CurrentUser() user: DecodedIdToken) {
    return this.notificationsService.getStatus(user.uid);
  }

  /**
   * Registra el dispositivo actual para recibir notificaciones push.
   */
  @UseGuards(FirebaseAuthGuard)
  @Post('subscribe')
  subscribe(
    @CurrentUser() user: DecodedIdToken,
    @Body() body: SubscribePushTokenDto,
  ) {
    return this.notificationsService.subscribeWebPush(user.uid, body);
  }

  /**
   * Elimina la suscripción push del dispositivo actual.
   */
  @UseGuards(FirebaseAuthGuard)
  @Delete('subscribe')
  unsubscribe(
    @CurrentUser() user: DecodedIdToken,
    @Body() body: UnsubscribePushTokenDto,
  ) {
    return this.notificationsService.unsubscribeWebPush(user.uid, body.token);
  }

  /**
   * Procesa los recordatorios diarios de gastos mediante el cron autorizado.
   */
  @UseGuards(CronAuthGuard)
  @Post('process-due-reminders')
  processDueReminders() {
    return this.notificationsService.processDueReminders();
  }
}
