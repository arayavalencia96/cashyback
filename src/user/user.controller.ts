import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { VerifyBlockCodeDto } from './dto/verify-block-code.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { CheckUserBlockStatusDto } from './dto/check-user-block-status.dto';
import { ManualPasswordUpdateDto } from './dto/manual-password-update.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from 'src/common/rate-limit/rate-limit.guard';

@UseGuards(RateLimitGuard)
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

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

  @RateLimit({
    limit: 12,
    windowMs: 60 * 1000,
    keyBy: ['ip'],
    message: 'Demasiadas actualizaciones',
    description:
      'Se alcanzó el máximo de actualizaciones desde esta IP. Intentá nuevamente más tarde.',
  })
  @Patch(':uid/status')
  setUserStatus(@Param('uid') uid: string, @Body() body: SetUserStatusDto) {
    return this.userService.setUserStatus(uid, body.disabled);
  }
}
