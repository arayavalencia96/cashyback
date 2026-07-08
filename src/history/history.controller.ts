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

  @Get('export/csv/:year/:month')
  async exportCsv(
    @CurrentUser() user: DecodedIdToken,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.historyService.exportGroupCsv(
      user.uid,
      year,
      month,
    );

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    response.status(200).send(file.content);
  }
}
