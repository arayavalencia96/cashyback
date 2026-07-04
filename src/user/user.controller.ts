import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { UserService } from './user.service';
import { VerifyBlockCodeDto } from './dto/verify-block-code.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { CheckUserBlockStatusDto } from './dto/check-user-block-status.dto';

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

  @Patch(':uid/status')
  setUserStatus(@Param('uid') uid: string, @Body() body: SetUserStatusDto) {
    return this.userService.setUserStatus(uid, body.disabled);
  }
}
