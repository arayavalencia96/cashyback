import { Module } from '@nestjs/common';
import { UserModule } from './user/user.module';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { HealthController } from './health.controller';
import { HistoryModule } from './history/history.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CommonModule,
    HistoryModule,
    NotificationsModule,
    UserModule,
  ],
})
export class AppModule {}
