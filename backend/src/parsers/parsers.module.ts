import { Module } from '@nestjs/common';
import { ParsersService } from './parsers.service';
import { DouyinParser } from './douyin.parser';
import { BilibiliParser } from './bilibili.parser';
import { XiaohongshuParser } from './xiaohongshu.parser';
import { KuaishouParser } from './kuaishou.parser';
import { YoutubeParser } from './youtube.parser';
import { BilibiliAuthModule } from '../bilibili-auth/bilibili-auth.module';
import { DouyinAuthModule } from '../douyin-auth/douyin-auth.module';
import { KuaishouAuthModule } from '../kuaishou-auth/kuaishou-auth.module';
import { DouyinOfficialModule } from '../douyin-official/douyin-official.module';
import { DouyinOptimizationModule } from '../douyin-optimization/douyin-optimization.module';
import { DouyinQualityModule } from '../douyin-quality/douyin-quality.module';

/**
 * 视频解析器模块
 */
@Module({
  imports: [
    BilibiliAuthModule,
    DouyinAuthModule,
    KuaishouAuthModule,
    DouyinOfficialModule,
    DouyinOptimizationModule,
    DouyinQualityModule,
  ],
  providers: [
    ParsersService,
    DouyinParser,
    BilibiliParser,
    XiaohongshuParser,
    KuaishouParser,
    YoutubeParser,
  ],
  exports: [ParsersService],
})
export class ParsersModule {}
