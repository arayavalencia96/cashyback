import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { RateLimitGuard } from 'src/common/rate-limit/rate-limit.guard';
import { CurrentUser } from 'src/common/auth/current-user.decorator';
import { FirebaseAuthGuard } from 'src/common/auth/firebase-auth.guard';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { UserService } from './user.service';

import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';

import { CheckUserBlockStatusDto } from './dto/check-user-block-status.dto';
import { ManualPasswordUpdateDto } from './dto/manual-password-update.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { VerifyBlockCodeDto } from './dto/verify-block-code.dto';

@UseGuards(RateLimitGuard)
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Elimina la cuenta autenticada y todos sus datos asociados.
   */
  @RateLimit({
    limit: 2,
    windowMs: 60 * 60 * 1000,
    keyBy: ['ip'],
    message: 'Demasiadas solicitudes de eliminación',
    description: 'Alcanzaste el límite de solicitudes de eliminación.',
  })
  @UseGuards(FirebaseAuthGuard)
  @Delete('account')
  deleteAccount(@CurrentUser() currentUser: DecodedIdToken | undefined) {
    if (!currentUser?.uid) {
      throw new ForbiddenException('No hay una cuenta autenticada.');
    }

    return this.userService.deleteAccount(currentUser.uid);
  }

  /**
   * Solicita un código para verificar la identidad de un usuario bloqueado.
   */
  @RateLimit(
    {
      limit: 3,
      windowMs: 15 * 60 * 1000,
      keyBy: ['params.uid'],
      message: 'Demasiadas solicitudes de código',
      description:
        'Se alcanzó el máximo de solicitudes de código para este usuario. Intentá nuevamente más tarde.',
    },
    {
      limit: 12,
      windowMs: 60 * 60 * 1000,
      keyBy: ['ip'],
      message: 'Demasiadas solicitudes desde esta IP',
      description:
        'Se alcanzó el máximo de solicitudes desde esta IP. Intentá nuevamente más tarde.',
    },
  )
  @Post(':uid/block-code')
  requestBlockCode(@Param('uid') uid: string) {
    return this.userService.requestBlockCode(uid);
  }

  /**
   * Verifica el código de desbloqueo y habilita el flujo de recuperación.
   */
  @RateLimit(
    {
      limit: 5,
      windowMs: 10 * 60 * 1000,
      keyBy: ['params.uid'],
      message: 'Demasiados intentos de verificación',
      description:
        'Se alcanzó el límite de intentos de verificación para este usuario. Intentá nuevamente más tarde.',
    },
    {
      limit: 20,
      windowMs: 60 * 60 * 1000,
      keyBy: ['ip'],
      message: 'Demasiados intentos desde esta IP',
      description:
        'Se alcanzó el límite de intentos desde esta IP. Intentá nuevamente más tarde.',
    },
  )
  @Post(':uid/block-code/verify')
  verifyBlockCode(@Param('uid') uid: string, @Body() body: VerifyBlockCodeDto) {
    return this.userService.verifyBlockCode(uid, body.code);
  }

  /**
   * Consulta por correo el estado de bloqueo y recuperación de una cuenta.
   */
  @RateLimit(
    {
      limit: 6,
      windowMs: 15 * 60 * 1000,
      keyBy: ['body.email'],
      message: 'Demasiadas consultas de bloqueo',
      description:
        'Se alcanzó el máximo de consultas para este correo. Intentá nuevamente más tarde.',
    },
    {
      limit: 18,
      windowMs: 60 * 60 * 1000,
      keyBy: ['ip'],
      message: 'Demasiadas consultas desde esta IP',
      description:
        'Se alcanzó el máximo de consultas desde esta IP. Intentá nuevamente más tarde.',
    },
  )
  @Post('block-code/check')
  checkBlockStatus(@Body() body: CheckUserBlockStatusDto) {
    return this.userService.checkBlockStatusByEmail(body.email);
  }

  /**
   * Registra un intento de inicio de sesión fallido para una cuenta.
   */
  @RateLimit(
    {
      limit: 6,
      windowMs: 15 * 60 * 1000,
      keyBy: ['body.email'],
      message: 'Demasiados intentos fallidos',
      description:
        'Se alcanzó el máximo de intentos fallidos para este correo. Intentá nuevamente más tarde.',
    },
    {
      limit: 18,
      windowMs: 60 * 60 * 1000,
      keyBy: ['ip'],
      message: 'Demasiados intentos desde esta IP',
      description:
        'Se alcanzó el máximo de intentos desde esta IP. Intentá nuevamente más tarde.',
    },
  )
  @Post('login-attempts/failure')
  registerFailedLoginAttempt(@Body() body: CheckUserBlockStatusDto) {
    return this.userService.registerFailedLoginAttempt(body.email);
  }

  /**
   * Reinicia los intentos fallidos después de una autenticación válida.
   */
  @RateLimit(
    {
      limit: 10,
      windowMs: 15 * 60 * 1000,
      keyBy: ['body.email'],
      message: 'Demasiados resets',
      description:
        'Se alcanzó el máximo de reseteos para este correo. Intentá nuevamente más tarde.',
    },
    {
      limit: 30,
      windowMs: 60 * 60 * 1000,
      keyBy: ['ip'],
      message: 'Demasiados resets desde esta IP',
      description:
        'Se alcanzó el máximo de reseteos desde esta IP. Intentá nuevamente más tarde.',
    },
  )
  @Post('login-attempts/reset')
  resetLoginAttempts(@Body() body: CheckUserBlockStatusDto) {
    return this.userService.resetLoginAttempts(body.email);
  }

  /**
   * Reenvía el correo de recuperación para un usuario verificado.
   */
  @RateLimit(
    {
      limit: 3,
      windowMs: 15 * 60 * 1000,
      keyBy: ['params.uid'],
      message: 'Demasiados reenvíos',
      description:
        'Se alcanzó el máximo de reenvíos para esta recuperación. Intentá nuevamente más tarde.',
    },
    {
      limit: 10,
      windowMs: 60 * 60 * 1000,
      keyBy: ['ip'],
      message: 'Demasiados reenvíos desde esta IP',
      description:
        'Se alcanzó el máximo de reenvíos desde esta IP. Intentá nuevamente más tarde.',
    },
  )
  @Post(':uid/password-reset/resend')
  resendPasswordResetEmail(@Param('uid') uid: string) {
    return this.userService.resendPasswordResetEmail(uid);
  }

  /**
   * Actualiza la contraseña mediante una sesión de recuperación válida.
   */
  @RateLimit(
    {
      limit: 5,
      windowMs: 15 * 60 * 1000,
      keyBy: ['body.sessionId'],
      message: 'Demasiados intentos de cambio',
      description:
        'Se alcanzó el máximo de intentos para esta sesión. Intentá nuevamente más tarde.',
    },
    {
      limit: 15,
      windowMs: 60 * 60 * 1000,
      keyBy: ['ip'],
      message: 'Demasiados intentos desde esta IP',
      description:
        'Se alcanzó el máximo de intentos desde esta IP. Intentá nuevamente más tarde.',
    },
  )
  @Post('password/manual')
  updatePasswordManually(@Body() body: ManualPasswordUpdateDto) {
    return this.userService.updatePasswordManually(
      body.sessionId ?? body.token ?? '',
      body.newPassword,
    );
  }

  /**
   * Activa o desactiva una cuenta de Firebase Authentication.
   */
  @RateLimit({
    limit: 12,
    windowMs: 60 * 1000,
    keyBy: ['ip'],
    message: 'Demasiadas actualizaciones',
    description:
      'Se alcanzó el máximo de actualizaciones desde esta IP. Intentá nuevamente más tarde.',
  })
  @UseGuards(FirebaseAuthGuard)
  @Patch(':uid/status')
  setUserStatus(
    @Param('uid') uid: string,
    @Body() body: SetUserStatusDto,
    @CurrentUser() currentUser: DecodedIdToken | undefined,
  ) {
    if (currentUser?.admin !== true) {
      throw new ForbiddenException(
        'Solo un administrador puede cambiar estados de cuenta.',
      );
    }

    return this.userService.setUserStatus(uid, body.disabled);
  }
}
