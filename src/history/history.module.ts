import { Module } from '@nestjs/common';

import { CommonModule } from 'src/common/common.module';

import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [CommonModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
