import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersModule } from '../admin/admin-users.module';
import { DouyinAuthController } from './douyin-auth.controller';
import { DouyinBridgeAuthService } from './douyin-bridge-auth.service';
import { DouyinAuthService } from './douyin-auth.service';
import { DouyinAuthSession } from './entities/douyin-auth-session.entity';
import { DouyinBridgeAuthSession } from './entities/douyin-bridge-auth-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DouyinAuthSession,
      DouyinBridgeAuthSession,
    ]),
    AdminUsersModule,
  ],
  controllers: [DouyinAuthController],
  providers: [
    DouyinBridgeAuthService,
    DouyinAuthService,
  ],
  exports: [DouyinAuthService, DouyinBridgeAuthService],
})
export class DouyinAuthModule {}
