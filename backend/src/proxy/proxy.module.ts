import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { BilibiliAuthModule } from '../bilibili-auth/bilibili-auth.module';
import { DouyinAuthModule } from '../douyin-auth/douyin-auth.module';
import { RuntimeMonitorModule } from '../runtime-monitor/runtime-monitor.module';

@Module({
  imports: [BilibiliAuthModule, DouyinAuthModule, RuntimeMonitorModule],
  controllers: [ProxyController],
})
export class ProxyModule {}
