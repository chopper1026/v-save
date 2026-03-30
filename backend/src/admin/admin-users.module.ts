import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { AdminAuditController } from './admin-audit.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { UserAdminAuditLog } from './entities/user-admin-audit-log.entity';
import { DownloadModeModule } from '../download-mode/download-mode.module';
import { AdminDownloadModesController } from './admin-download-modes.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserAdminAuditLog]),
    NotificationsModule,
    DownloadModeModule,
  ],
  controllers: [
    AdminUsersController,
    AdminAuditController,
    AdminDownloadModesController,
  ],
  providers: [AdminUsersService],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}
