import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DouyinProbeMode,
  VideoFormat,
} from '../download/dto/download.dto';
import {
  VideoDownloadOptions,
  VideoInfo,
  VideoStreamCandidate,
} from '../parsers/base.interface';
import { DownloadModeConfig } from './entities/download-mode-config.entity';
import {
  DownloadClientType,
  DownloadModeConfigView,
  DownloadModePlatform,
  DownloadModeSchemaItem,
  DownloadModeSource,
  DownloadPolicyMode,
  ResolveDownloadModeInput,
  ResolvedDownloadModePolicy,
} from './download-mode.types';

interface UpdateModeConfigInput {
  platform: DownloadModePlatform;
  clientType: DownloadClientType;
  mode: DownloadPolicyMode;
  updatedByUserId: string;
  updatedByEmail: string;
}

type EditablePlatform = DownloadModePlatform.DOUYIN | DownloadModePlatform.BILIBILI;

type PlatformModeCatalog = Record<EditablePlatform, DownloadPolicyMode[]>;

@Injectable()
export class DownloadModeService {
  private readonly editableModeCatalog: PlatformModeCatalog = {
    [DownloadModePlatform.DOUYIN]: [
      DownloadPolicyMode.QUALITY_FIRST,
      DownloadPolicyMode.SPEED_FIRST,
      DownloadPolicyMode.AVAILABILITY_FIRST,
    ],
    [DownloadModePlatform.BILIBILI]: [
      DownloadPolicyMode.QUALITY_FIRST,
      DownloadPolicyMode.COMPATIBILITY_FIRST,
    ],
  };

  private readonly platformLabels: Record<DownloadModePlatform, string> = {
    [DownloadModePlatform.DOUYIN]: '抖音',
    [DownloadModePlatform.BILIBILI]: 'B站',
    [DownloadModePlatform.XIAOHONGSHU]: '小红书',
    [DownloadModePlatform.KUAISHOU]: '快手',
    [DownloadModePlatform.YOUTUBE]: 'YouTube',
  };

  constructor(
    @InjectRepository(DownloadModeConfig)
    private readonly downloadModeRepository: Repository<DownloadModeConfig>,
  ) {}

  getSchema(): {
    clientTypes: DownloadClientType[];
    platforms: DownloadModeSchemaItem[];
  } {
    return {
      clientTypes: [DownloadClientType.WEB, DownloadClientType.MOBILE],
      platforms: this.getPlatformOrder().map((platform) => ({
        platform,
        label: this.platformLabels[platform],
        editable: this.isEditablePlatform(platform),
        readonlyReason: this.isEditablePlatform(platform)
          ? null
          : '当前平台暂无后台可调下载模式，维持固定策略。',
        modeOptions: this.getModeOptions(platform),
      })),
    };
  }

  async getConfigs(): Promise<DownloadModeConfigView[]> {
    const rows = await this.downloadModeRepository.find();
    const configMap = new Map<string, DownloadModeConfig>();
    rows.forEach((row) => {
      configMap.set(this.toConfigKey(row.platform, row.clientType), row);
    });

    return this.getPlatformOrder().map((platform) => {
      const editable = this.isEditablePlatform(platform);
      return {
        platform,
        label: this.platformLabels[platform],
        editable,
        readonlyReason: editable
          ? null
          : '当前平台暂无后台可调下载模式，维持固定策略。',
        clients: {
          [DownloadClientType.WEB]: this.toClientConfigView(
            platform,
            DownloadClientType.WEB,
            configMap.get(this.toConfigKey(platform, DownloadClientType.WEB)),
          ),
          [DownloadClientType.MOBILE]: this.toClientConfigView(
            platform,
            DownloadClientType.MOBILE,
            configMap.get(this.toConfigKey(platform, DownloadClientType.MOBILE)),
          ),
        },
      };
    });
  }

  async updateModeConfig(
    input: UpdateModeConfigInput,
  ): Promise<DownloadModeConfigView['clients'][DownloadClientType]> {
    const platform = this.normalizePlatform(input.platform);
    if (!this.isEditablePlatform(platform)) {
      throw new BadRequestException('当前平台不支持后台调整下载模式');
    }

    const allowedModes = this.editableModeCatalog[platform];
    if (!allowedModes.includes(input.mode)) {
      throw new BadRequestException('当前平台不支持该下载模式');
    }

    const existing = await this.downloadModeRepository.findOne({
      where: {
        platform,
        clientType: input.clientType,
      },
    });

    const entity = this.downloadModeRepository.create({
      ...(existing || {}),
      platform,
      clientType: input.clientType,
      mode: input.mode,
      updatedByUserId: input.updatedByUserId,
      updatedByEmail: input.updatedByEmail,
    });
    const saved = await this.downloadModeRepository.save(entity);

    return this.toClientConfigView(platform, input.clientType, saved);
  }

  async resolveGetUrlPolicy(
    input: ResolveDownloadModeInput,
  ): Promise<ResolvedDownloadModePolicy> {
    const info = this.parseVideoInfo(input.videoInfo);
    const platform = this.normalizePlatform(info.platform);
    const overrideProbeMode = input.overrides?.probeMode;
    const overrideAllowWatermarkFallback = input.overrides?.allowWatermarkFallback;
    const overrideIosCompatible = input.overrides?.iosCompatible;

    const fallbackPolicy: ResolvedDownloadModePolicy = {
      clientType: input.clientType,
      platform,
      mode: null,
      source: this.isEditablePlatform(platform)
        ? DownloadModeSource.DEFAULT
        : DownloadModeSource.READONLY,
      iosCompatible: false,
      allowWatermarkFallback: true,
      probeMode: DouyinProbeMode.STRICT,
    };

    if (!this.isEditablePlatform(platform)) {
      return {
        ...fallbackPolicy,
        iosCompatible: overrideIosCompatible ?? fallbackPolicy.iosCompatible,
        allowWatermarkFallback:
          overrideAllowWatermarkFallback ?? fallbackPolicy.allowWatermarkFallback,
        probeMode: overrideProbeMode ?? fallbackPolicy.probeMode,
      };
    }

    const config = await this.downloadModeRepository.findOne({
      where: {
        platform,
        clientType: input.clientType,
      },
    });

    const mode = config?.mode || this.getDefaultMode(platform, input.clientType);
    const source = config ? DownloadModeSource.DATABASE : DownloadModeSource.DEFAULT;

    const basePolicy = this.mapModeToPolicy({
      platform,
      mode,
      info,
      format: input.format,
      quality: input.quality,
    });

    return {
      clientType: input.clientType,
      platform,
      mode,
      source,
      iosCompatible: overrideIosCompatible ?? basePolicy.iosCompatible,
      allowWatermarkFallback:
        overrideAllowWatermarkFallback ?? basePolicy.allowWatermarkFallback,
      probeMode: overrideProbeMode ?? basePolicy.probeMode,
    };
  }

  private mapModeToPolicy(input: {
    platform: EditablePlatform;
    mode: DownloadPolicyMode;
    info: VideoInfo;
    format?: VideoFormat;
    quality?: string;
  }): Pick<ResolvedDownloadModePolicy, 'iosCompatible' | 'allowWatermarkFallback' | 'probeMode'> {
    if (input.platform === DownloadModePlatform.DOUYIN) {
      switch (input.mode) {
        case DownloadPolicyMode.QUALITY_FIRST:
          return {
            iosCompatible: false,
            allowWatermarkFallback: false,
            probeMode: DouyinProbeMode.STRICT,
          };
        case DownloadPolicyMode.SPEED_FIRST:
          return {
            iosCompatible: false,
            allowWatermarkFallback: true,
            probeMode: DouyinProbeMode.FAST,
          };
        case DownloadPolicyMode.AVAILABILITY_FIRST:
        default:
          return {
            iosCompatible: false,
            allowWatermarkFallback: true,
            probeMode: DouyinProbeMode.SMART,
          };
      }
    }

    return {
      iosCompatible:
        input.mode === DownloadPolicyMode.COMPATIBILITY_FIRST
          ? this.shouldUseBilibiliSmartCompatibility(
              input.info,
              input.quality,
              input.format,
            )
          : false,
      allowWatermarkFallback: true,
      probeMode: DouyinProbeMode.STRICT,
    };
  }

  private shouldUseBilibiliSmartCompatibility(
    info: VideoInfo,
    requestedQuality?: string,
    format?: VideoFormat,
  ): boolean {
    if (info.platform !== DownloadModePlatform.BILIBILI) {
      return false;
    }
    if (format === VideoFormat.AUDIO) {
      return false;
    }

    const downloadOptions = info.downloadOptions;
    if (!downloadOptions) {
      return false;
    }

    const videoMap = this.toNormalizedVideoMap(downloadOptions.video);
    const candidateMap = this.toNormalizedCandidateMap(downloadOptions.videoCandidates);
    const fallbackOrder = this.getVideoQualityFallbackOrder(requestedQuality || '720p');
    const resolvedQuality = fallbackOrder.find((quality) => !!videoMap[quality]);
    if (!resolvedQuality) {
      return false;
    }

    const defaultVideoUrl = videoMap[resolvedQuality];
    const candidates = candidateMap[resolvedQuality] || [];
    if (!defaultVideoUrl || candidates.length === 0) {
      return false;
    }

    const defaultCandidate = this.findCandidateByDefaultUrl(candidates, defaultVideoUrl);
    if (!defaultCandidate) {
      return false;
    }

    return defaultCandidate.codecid !== 7;
  }

  private toNormalizedVideoMap(
    input: Record<string, string> | undefined,
  ): Record<string, string> {
    const map: Record<string, string> = {};
    Object.entries(input || {}).forEach(([quality, url]) => {
      const key = this.normalizeQualityKey(quality);
      const normalizedUrl = String(url || '').trim();
      if (!key || !normalizedUrl) {
        return;
      }
      map[key] = normalizedUrl;
    });
    return map;
  }

  private toNormalizedCandidateMap(
    input: VideoDownloadOptions['videoCandidates'],
  ): Record<string, VideoStreamCandidate[]> {
    const map: Record<string, VideoStreamCandidate[]> = {};
    Object.entries(input || {}).forEach(([quality, candidates]) => {
      const key = this.normalizeQualityKey(quality);
      if (!key || !Array.isArray(candidates) || candidates.length === 0) {
        return;
      }
      map[key] = candidates;
    });
    return map;
  }

  private getVideoQualityFallbackOrder(quality: string): string[] {
    switch (this.normalizeQualityKey(quality)) {
      case '4k':
        return ['4k', '1080p', '720p', '540p', '480p', '360p'];
      case '1080p':
      case '1440p':
        return ['1080p', '720p', '540p', '480p', '360p', '4k'];
      case '540p':
        return ['540p', '480p', '360p', '720p', '1080p', '4k'];
      case '480p':
        return ['480p', '360p', '540p', '720p', '1080p', '4k'];
      case '360p':
        return ['360p', '480p', '540p', '720p', '1080p', '4k'];
      case '720p':
      default:
        return ['720p', '540p', '480p', '360p', '1080p', '4k'];
    }
  }

  private normalizeQualityKey(quality: string): string {
    return String(quality || '').trim().toLowerCase();
  }

  private findCandidateByDefaultUrl(
    candidates: VideoStreamCandidate[],
    defaultUrl: string,
  ): VideoStreamCandidate | null {
    const normalizedDefaultUrl = String(defaultUrl || '').trim();
    if (!normalizedDefaultUrl) {
      return null;
    }

    const exactMatched = candidates.find(
      (item) => String(item?.url || '').trim() === normalizedDefaultUrl,
    );
    if (exactMatched) {
      return exactMatched;
    }

    const defaultIdentity = this.toMediaIdentity(normalizedDefaultUrl);
    if (!defaultIdentity) {
      return null;
    }

    return (
      candidates.find((item) => {
        const candidateIdentity = this.toMediaIdentity(String(item?.url || '').trim());
        return candidateIdentity === defaultIdentity;
      }) || null
    );
  }

  private toMediaIdentity(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }

    try {
      const parsed = new URL(normalized);
      return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
    } catch (_error) {
      const raw = normalized.split('?')[0]?.split('#')[0] || '';
      return raw.toLowerCase();
    }
  }

  private toClientConfigView(
    platform: DownloadModePlatform,
    clientType: DownloadClientType,
    row?: DownloadModeConfig | null,
  ): DownloadModeConfigView['clients'][DownloadClientType] {
    if (!this.isEditablePlatform(platform)) {
      return {
        clientType,
        mode: null,
        source: DownloadModeSource.READONLY,
        editable: false,
        updatedAt: null,
        updatedByEmail: null,
      };
    }

    return {
      clientType,
      mode: row?.mode || this.getDefaultMode(platform, clientType),
      source: row ? DownloadModeSource.DATABASE : DownloadModeSource.DEFAULT,
      editable: true,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      updatedByEmail: row?.updatedByEmail || null,
    };
  }

  private getModeOptions(platform: DownloadModePlatform) {
    if (platform === DownloadModePlatform.DOUYIN) {
      return [
        {
          mode: DownloadPolicyMode.QUALITY_FIRST,
          label: '画质优先',
          description: '优先严格探测高分辨率无水印线路。',
        },
        {
          mode: DownloadPolicyMode.SPEED_FIRST,
          label: '速度优先',
          description: '优先快速返回可下载线路。',
        },
        {
          mode: DownloadPolicyMode.AVAILABILITY_FIRST,
          label: '可用性优先',
          description: '优先兼顾探测命中率与下载稳定性。',
        },
      ];
    }

    if (platform === DownloadModePlatform.BILIBILI) {
      return [
        {
          mode: DownloadPolicyMode.QUALITY_FIRST,
          label: '标准优先',
          description: '保持默认选流，不启用 iOS 兼容首发。',
        },
        {
          mode: DownloadPolicyMode.COMPATIBILITY_FIRST,
          label: '兼容优先',
          description: '按候选编码智能判断是否启用兼容链路。',
        },
      ];
    }

    return [];
  }

  private getPlatformOrder(): DownloadModePlatform[] {
    return [
      DownloadModePlatform.DOUYIN,
      DownloadModePlatform.BILIBILI,
      DownloadModePlatform.XIAOHONGSHU,
      DownloadModePlatform.KUAISHOU,
      DownloadModePlatform.YOUTUBE,
    ];
  }

  private parseVideoInfo(videoInfo: VideoInfo | string): VideoInfo {
    if (typeof videoInfo !== 'string') {
      return videoInfo;
    }
    return JSON.parse(videoInfo) as VideoInfo;
  }

  private toConfigKey(platform: DownloadModePlatform, clientType: DownloadClientType): string {
    return `${platform}:${clientType}`;
  }

  private normalizePlatform(platform: string): DownloadModePlatform {
    if (Object.values(DownloadModePlatform).includes(platform as DownloadModePlatform)) {
      return platform as DownloadModePlatform;
    }
    throw new BadRequestException('不支持的视频平台');
  }

  private isEditablePlatform(platform: DownloadModePlatform): platform is EditablePlatform {
    return (
      platform === DownloadModePlatform.DOUYIN ||
      platform === DownloadModePlatform.BILIBILI
    );
  }

  private getDefaultMode(
    platform: EditablePlatform,
    clientType: DownloadClientType,
  ): DownloadPolicyMode {
    if (platform === DownloadModePlatform.DOUYIN) {
      return clientType === DownloadClientType.WEB
        ? DownloadPolicyMode.AVAILABILITY_FIRST
        : DownloadPolicyMode.QUALITY_FIRST;
    }

    return clientType === DownloadClientType.WEB
      ? DownloadPolicyMode.QUALITY_FIRST
      : DownloadPolicyMode.COMPATIBILITY_FIRST;
  }
}
