import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersModule } from '../admin/admin-users.module';
import { KuaishouAuthController } from './kuaishou-auth.controller';
import { KuaishouAuthService } from './kuaishou-auth.service';
import { KuaishouAuthSession } from './entities/kuaishou-auth-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([KuaishouAuthSession]),
    AdminUsersModule,
  ],
  controllers: [KuaishouAuthController],
  providers: [KuaishouAuthService],
  exports: [KuaishouAuthService],
})
export class KuaishouAuthModule {}
