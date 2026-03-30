import { Module } from '@nestjs/common';
import { DouyinAuthModule } from '../douyin-auth/douyin-auth.module';
import { DouyinOfficialModule } from '../douyin-official/douyin-official.module';
import { DouyinQualityService } from './douyin-quality.service';

@Module({
  imports: [DouyinAuthModule, DouyinOfficialModule],
  providers: [DouyinQualityService],
  exports: [DouyinQualityService],
})
export class DouyinQualityModule {}
