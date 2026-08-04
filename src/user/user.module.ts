import { Module } from '@nestjs/common';

import { CommonModule } from 'src/common/common.module';

import { UserController } from './user.controller';
import { UserDataExportController } from './user-data-export.controller';

import { UserDataExportService } from './user-data-export.service';
import { UserService } from './user.service';

@Module({
  imports: [CommonModule],
  controllers: [UserController, UserDataExportController],
  providers: [UserService, UserDataExportService],
})
export class UserModule {}
