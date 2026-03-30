import { Injectable, Logger, Optional } from '@nestjs/common';
import { VideoParser, VideoInfo } from './base.interface';
import { DouyinParser } from './douyin.parser';
import { BilibiliParser } from './bilibili.parser';
import { XiaohongshuParser } from './xiaohongshu.parser';
import { KuaishouParser } from './kuaishou.parser';
import { YoutubeParser } from './youtube.parser';
import { DouyinQualityService } from '../douyin-quality/douyin-quality.service';

/**
 * 视频解析器服务
 */
@Injectable()
export class ParsersService {
  private readonly logger = new Logger(ParsersService.name);
  private readonly parsers: VideoParser[] = [];

  constructor(
    private readonly douyinParser: DouyinParser,
    private readonly bilibiliParser: BilibiliParser,
    private readonly xiaohongshuParser: XiaohongshuParser,
    private readonly kuaishouParser: KuaishouParser,
    private readonly youtubeParser: YoutubeParser,
    @Optional()
    private readonly douyinQualityService?: DouyinQualityService,
  ) {
    // 注册所有解析器
    this.registerParser(douyinParser);
    this.registerParser(bilibiliParser);
    this.registerParser(xiaohongshuParser);
    this.registerParser(kuaishouParser);
    this.registerParser(youtubeParser);
  }

  /**
   * 注册解析器
   */
  registerParser(parser: VideoParser): void {
    this.parsers.push(parser);
    this.logger.log(`已注册解析器: ${parser.platform}`);
  }

  /**
   * 检测URL属于哪个平台
   */
  detectPlatform(url: string): VideoInfo['platform'] | null {
    for (const parser of this.parsers) {
      if (parser.supports(url)) {
        return parser.platform;
      }
    }
    return null;
  }

  /**
   * 解析视频信息
   * 遍历所有解析器，找到支持的并解析
   */
  async parse(url: string): Promise<VideoInfo | null> {
    const platform = this.detectPlatform(url);

    if (!platform) {
      this.logger.warn(`不支持的平台: ${url}`);
      return null;
    }

    for (const parser of this.parsers) {
      if (parser.supports(url)) {
        this.logger.log(`开始解析视频: ${url}, 平台: ${platform}`);
        try {
          return await parser.parse(url);
        } catch (error) {
          this.logger.error(`解析视频失败: ${error.message}`);
          throw error;
        }
      }
    }

    return null;
  }

  /**
   * 获取所有已注册的解析器
   */
  getParsers(): VideoParser[] {
    return this.parsers;
  }

  getDouyinQualityStatus(refreshKey: string): VideoInfo | null {
    if (!this.douyinQualityService) {
      return null;
    }
    return this.douyinQualityService.getQualityStatus(refreshKey);
  }

  async awaitDouyinQualityStatus(
    refreshKey: string,
    waitMs = 0,
  ): Promise<VideoInfo | null> {
    if (!this.douyinQualityService) {
      return null;
    }
    return this.douyinQualityService.awaitQualityStatus(refreshKey, waitMs);
  }
}
