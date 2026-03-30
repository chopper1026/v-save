import { IsString, IsEnum, IsOptional, IsUrl, IsObject } from 'class-validator';

/**
 * 平台枚举
 */
export enum Platform {
  DOUYIN = 'douyin',
  BILIBILI = 'bilibili',
  XIAOHONGSHU = 'xiaohongshu',
  KUAISHOU = 'kuaishou',
  YOUTUBE = 'youtube',
}

/**
 * 解析结果DTO
 */
export class ParseResultDto {
  @IsString()
  title: string;

  @IsUrl()
  cover: string;

  @IsString()
  duration: string;

  @IsEnum(Platform)
  platform: Platform;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUrl()
  videoUrl: string;

  @IsOptional()
  @IsUrl()
  audioUrl?: string;

  @IsOptional()
  @IsObject()
  downloadOptions?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  qualityStatus?: 'complete' | 'enriching' | 'session_required' | 'source_single_quality';

  @IsOptional()
  @IsString()
  qualityRefreshKey?: string;

  @IsOptional()
  @IsString()
  qualityMessage?: string;
}
