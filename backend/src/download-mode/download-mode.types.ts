import type { DouyinProbeMode, VideoFormat } from '../download/dto/download.dto';
import { VideoInfo } from '../parsers/base.interface';

export enum DownloadClientType {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
}

export enum DownloadModePlatform {
  DOUYIN = 'douyin',
  BILIBILI = 'bilibili',
  XIAOHONGSHU = 'xiaohongshu',
  KUAISHOU = 'kuaishou',
  YOUTUBE = 'youtube',
}

export enum DownloadPolicyMode {
  QUALITY_FIRST = 'QUALITY_FIRST',
  SPEED_FIRST = 'SPEED_FIRST',
  AVAILABILITY_FIRST = 'AVAILABILITY_FIRST',
  COMPATIBILITY_FIRST = 'COMPATIBILITY_FIRST',
}

export enum DownloadModeSource {
  DEFAULT = 'default',
  DATABASE = 'database',
  READONLY = 'readonly',
}

export interface DownloadModeOption {
  mode: DownloadPolicyMode;
  label: string;
  description: string;
}

export interface DownloadModeSchemaItem {
  platform: DownloadModePlatform;
  label: string;
  editable: boolean;
  readonlyReason: string | null;
  modeOptions: DownloadModeOption[];
}

export interface DownloadModeClientConfigView {
  clientType: DownloadClientType;
  mode: DownloadPolicyMode | null;
  source: DownloadModeSource;
  editable: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export interface DownloadModeConfigView {
  platform: DownloadModePlatform;
  label: string;
  editable: boolean;
  readonlyReason: string | null;
  clients: Record<DownloadClientType, DownloadModeClientConfigView>;
}

export interface ResolveDownloadModeInput {
  clientType: DownloadClientType;
  videoInfo: VideoInfo | string;
  format?: VideoFormat;
  quality?: string;
  overrides?: {
    iosCompatible?: boolean;
    allowWatermarkFallback?: boolean;
    probeMode?: DouyinProbeMode;
  };
}

export interface ResolvedDownloadModePolicy {
  clientType: DownloadClientType;
  platform: DownloadModePlatform;
  mode: DownloadPolicyMode | null;
  source: DownloadModeSource;
  iosCompatible: boolean;
  allowWatermarkFallback: boolean;
  probeMode: DouyinProbeMode;
}
