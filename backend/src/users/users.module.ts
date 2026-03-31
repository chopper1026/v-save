import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { SuperAdminBootstrapService } from './super-admin-bootstrap.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), NotificationsModule],
  providers: [UsersService, SuperAdminBootstrapService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
