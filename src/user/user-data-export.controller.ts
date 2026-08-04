import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { CurrentUser } from 'src/common/auth/current-user.decorator';
import { FirebaseAuthGuard } from 'src/common/auth/firebase-auth.guard';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from 'src/common/rate-limit/rate-limit.guard';

import { UserDataExportService } from './user-data-export.service';

@UseGuards(RateLimitGuard, FirebaseAuthGuard)
@Controller('user')
export class UserDataExportController {
  constructor(private readonly userDataExportService: UserDataExportService) {}

  /** Descarga una copia portable de todos los datos del usuario autenticado. */
  @RateLimit({
    limit: 3,
    windowMs: 60 * 60 * 1000,
    keyBy: ['ip'],
    message: 'Demasiadas exportaciones solicitadas',
    description: 'Intentá descargar tus datos nuevamente más tarde.',
  })
  @Get('data-export')
  async download(
    @CurrentUser() user: DecodedIdToken,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.userDataExportService.generate(user.uid);

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    response.status(200).send(file.content);
  }
}
