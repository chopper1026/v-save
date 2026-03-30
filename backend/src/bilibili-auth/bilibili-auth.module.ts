import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersModule } from '../admin/admin-users.module';
import { BilibiliAuthController } from './bilibili-auth.controller';
import { BilibiliAuthService } from './bilibili-auth.service';
import { BilibiliAuthSession } from './entities/bilibili-auth-session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BilibiliAuthSession]), AdminUsersModule],
  controllers: [BilibiliAuthController],
  providers: [BilibiliAuthService],
  exports: [BilibiliAuthService],
})
export class BilibiliAuthModule {}
