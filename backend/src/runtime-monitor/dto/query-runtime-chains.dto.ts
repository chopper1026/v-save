import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { RuntimeDashboardWindow, RuntimePlatform } from '../runtime-monitor.types';

export class QueryRuntimeChainsDto {
  @IsOptional()
  @IsIn(['today', '24h', '7d'])
  window?: RuntimeDashboardWindow;

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim().toLowerCase())
  @IsIn([
    'douyin',
    'bilibili',
    'xiaohongshu',
    'kuaishou',
    'youtube',
    'unknown',
  ])
  platform?: RuntimePlatform;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
