import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { CurrentUser } from 'src/common/auth/current-user.decorator';
import { FirebaseAuthGuard } from 'src/common/auth/firebase-auth.guard';

import { HistoryService } from './history.service';

@UseGuards(FirebaseAuthGuard)
@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('export/xlsx/:year/:month')
  async exportXlsx(
    @CurrentUser() user: DecodedIdToken,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.historyService.exportGroupXlsx(
      user.uid,
      year,
      month,
    );

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
