import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsInt,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DownloadClientType } from '../../download-mode/download-mode.types';
import { toOptionalClampedInt } from '../../config/query-transform';

/**
 * 视频格式枚举
 */
export enum VideoFormat {
  MP4 = 'mp4',
  WEBM = 'webm',
  AUDIO = 'audio',
}

/**
 * 视频质量枚举
 */
export enum VideoQuality {
  SD = '360p',
  HD = '720p',
  FHD = '1080p',
  QHD = '1440p',
  UHD = '4k',
}

export enum DouyinProbeMode {
  STRICT = 'strict',
  FAST = 'fast',
  SMART = 'smart',
}

/**
 * 解析视频DTO
 */
export class ParseVideoDto {
  @IsString()
  url: string;

  @IsOptional()
  @IsEnum(DownloadClientType)
  clientType?: DownloadClientType;
}

/**
 * 获取下载链接DTO
 */
export class GetDownloadUrlDto {
  @IsString()
  videoInfo: string; // JSON序列化的视频信息

  @IsEnum(DownloadClientType)
  clientType: DownloadClientType;

  @IsEnum(VideoFormat)
  @IsOptional()
  format?: VideoFormat;

  @IsString()
  @IsOptional()
  quality?: string;

  @IsBoolean()
  @IsOptional()
  iosCompatible?: boolean;

  @IsBoolean()
  @IsOptional()
  allowWatermarkFallback?: boolean;

  @IsEnum(DouyinProbeMode)
  @IsOptional()
  probeMode?: DouyinProbeMode;
}

/**
 * 创建异步下载任务 DTO
 */
export class CreateDownloadTaskDto {
  @IsString()
  sourceUrl: string;

  @IsString()
  videoInfo: string; // JSON序列化的视频信息

  @IsEnum(VideoFormat)
  @IsOptional()
  format?: VideoFormat;

  @IsString()
  @IsOptional()
  quality?: string;
}

export class PrepareNativeSilentDownloadDto {
  @IsString()
  sourceUrl: string;

  @IsOptional()
  @IsEnum(DownloadClientType)
  clientType?: DownloadClientType;
}

/**
 * 下载历史查询DTO
 */
export class QueryDownloadHistoryDto {
  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Transform(toOptionalClampedInt({ min: 1, max: 50 }))
  @IsInt()
  limit?: number;

  @IsOptional()
  @Transform(toOptionalClampedInt({ min: 0 }))
  @IsInt()
  offset?: number;

  @IsOptional()
  @IsString()
  includeStats?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class DeleteDownloadHistoriesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}
