import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthHealthStatus } from './entities/auth-health-status.entity';
import { AuthHealthService } from './auth-health.service';
import { AuthHealthController } from './auth-health.controller';
import { BilibiliAuthModule } from '../bilibili-auth/bilibili-auth.module';
import { DouyinAuthModule } from '../douyin-auth/douyin-auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthHealthStatus]),
    BilibiliAuthModule,
    DouyinAuthModule,
    NotificationsModule,
  ],
  providers: [AuthHealthService],
  controllers: [AuthHealthController],
  exports: [AuthHealthService],
})
export class AuthHealthModule {}

