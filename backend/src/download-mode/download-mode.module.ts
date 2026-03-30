import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DownloadModeConfig } from './entities/download-mode-config.entity';
import { DownloadModeService } from './download-mode.service';

@Module({
  imports: [TypeOrmModule.forFeature([DownloadModeConfig])],
  providers: [DownloadModeService],
  exports: [DownloadModeService],
})
export class DownloadModeModule {}
