import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DownloadService } from './download.service';
import { DownloadController } from './download.controller';
import { DownloadHistory } from './entities/download-history.entity';
import { DownloadTask } from './entities/download-task.entity';
import { ParsersModule } from '../parsers/parsers.module';
import { UsersModule } from '../users/users.module';
import { BilibiliAuthModule } from '../bilibili-auth/bilibili-auth.module';
import { AuthHealthModule } from '../auth-health/auth-health.module';
import { DownloadModeModule } from '../download-mode/download-mode.module';
import { RuntimeMonitorModule } from '../runtime-monitor/runtime-monitor.module';
import { DouyinOptimizationModule } from '../douyin-optimization/douyin-optimization.module';

/**
 * 下载模块
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DownloadHistory, DownloadTask]),
    ParsersModule,
    UsersModule,
    BilibiliAuthModule,
    AuthHealthModule,
    DownloadModeModule,
    RuntimeMonitorModule,
    DouyinOptimizationModule,
  ],
  controllers: [DownloadController],
  providers: [DownloadService],
  exports: [DownloadService],
})
export class DownloadModule {}
