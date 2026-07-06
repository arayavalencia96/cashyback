import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { UserService } from './user.service';
import { VerifyBlockCodeDto } from './dto/verify-block-code.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { CheckUserBlockStatusDto } from './dto/check-user-block-status.dto';
import { ManualPasswordUpdateDto } from './dto/manual-password-update.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post(':uid/block-code')
  requestBlockCode(@Param('uid') uid: string) {
    return this.userService.requestBlockCode(uid);
  }

  @Post(':uid/block-code/verify')
  verifyBlockCode(@Param('uid') uid: string, @Body() body: VerifyBlockCodeDto) {
    return this.userService.verifyBlockCode(uid, body.code);
  }

  @Post('block-code/check')
  checkBlockStatus(@Body() body: CheckUserBlockStatusDto) {
    return this.userService.checkBlockStatusByEmail(body.email);
  }

  @Post('login-attempts/failure')
  registerFailedLoginAttempt(@Body() body: CheckUserBlockStatusDto) {
    return this.userService.registerFailedLoginAttempt(body.email);
  }

  @Post('login-attempts/reset')
  resetLoginAttempts(@Body() body: CheckUserBlockStatusDto) {
    return this.userService.resetLoginAttempts(body.email);
  }

  @Post(':uid/password-reset/resend')
  resendPasswordResetEmail(@Param('uid') uid: string) {
    return this.userService.resendPasswordResetEmail(uid);
  }

  @Post('password/manual')
  updatePasswordManually(@Body() body: ManualPasswordUpdateDto) {
    return this.userService.updatePasswordManually(
      body.sessionId ?? body.token ?? '',
      body.newPassword,
    );
  }

  @Patch(':uid/status')
  setUserStatus(@Param('uid') uid: string, @Body() body: SetUserStatusDto) {
    return this.userService.setUserStatus(uid, body.disabled);
  }
}
