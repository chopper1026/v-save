import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type {
  VideoDownloadOptions,
  VideoInfo,
  VideoStreamCandidate,
} from '../parsers/base.interface';
import { DouyinSignatureService } from './douyin-signature.service';

const DOUYIN_DETAIL_ENDPOINT =
  'https://www.douyin.com/aweme/v1/web/aweme/detail/';
const DOUYIN_OFFICIAL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36';

@Injectable()
export class DouyinOfficialDetailService {
  private readonly requestTimeoutMs = this.readPositiveIntEnv(
    'DOUYIN_OFFICIAL_DETAIL_TIMEOUT_MS',
    20_000,
  );

  constructor(
    private readonly signatureService: DouyinSignatureService,
  ) {}

  async fetchVideoInfo(
    videoId: string,
    cookieHeader: string,
  ): Promise<VideoInfo> {
    const normalizedVideoId = String(videoId || '').trim();
    if (!normalizedVideoId) {
      throw new Error('抖音官方详情请求缺少 aweme_id');
    }

    const normalizedCookie = String(cookieHeader || '').trim();
    if (!normalizedCookie) {
      throw new Error('抖音官方详情请求缺少有效 cookie');
    }

    const params = this.buildDetailParams(normalizedVideoId);
    const aBogus = await this.signatureService.generateABogus(params);
    const query = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ).toString();
    const url = `${DOUYIN_DETAIL_ENDPOINT}?${query}&a_bogus=${aBogus}`;

    const response = await axios.get(url, {
      timeout: this.requestTimeoutMs,
      validateStatus: () => true,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
        Referer: `https://www.douyin.com/video/${normalizedVideoId}`,
        'User-Agent': DOUYIN_OFFICIAL_USER_AGENT,
        Cookie: normalizedCookie,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      const error: any = new Error(
        `抖音官方详情请求失败: HTTP ${response.status}`,
      );
      error.status = response.status;
      error.responseData = response.data;
      throw error;
    }

    const detail =
      response?.data?.aweme_detail || response?.data?.data?.aweme_detail;
    if (!detail?.video) {
      const snippet = JSON.stringify(response?.data || '').slice(0, 300);
      throw new Error(`抖音官方详情响应缺少 aweme_detail.video: ${snippet}`);
    }

    return this.extractFromAwemeDetail(normalizedVideoId, detail);
  }

  private buildDetailParams(videoId: string): Record<string, string> {
    return {
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      pc_client_type: '1',
      version_code: '290100',
      version_name: '29.1.0',
      cookie_enabled: 'true',
      screen_width: '1920',
      screen_height: '1080',
      browser_language: 'zh-CN',
      browser_platform: 'Win32',
      browser_name: 'Chrome',
      browser_version: '130.0.0.0',
      browser_online: 'true',
      engine_name: 'Blink',
      engine_version: '130.0.0.0',
      os_name: 'Windows',
      os_version: '10',
      cpu_core_num: '12',
      device_memory: '8',
      platform: 'PC',
      downlink: '10',
      effective_type: '4g',
      from_user_page: '1',
      locate_query: 'false',
      need_time_list: '1',
      pc_libra_divert: 'Windows',
      publish_video_strategy_type: '2',
      round_trip_time: '0',
      show_live_replay_strategy: '1',
      time_list_query: '0',
      whale_cut_token: '',
      update_version_code: '170400',
      aweme_id: videoId,
      msToken: this.signatureService.generateMsToken(),
    };
  }

  private extractFromAwemeDetail(videoId: string, detail: any): VideoInfo {
    const videoData = detail?.video || {};
    const musicData = detail?.music || {};
    const downloadOptions = this.buildDownloadOptionsFromDouyinVideo(videoData);

    return {
      title: detail?.desc || '抖音视频',
      cover:
        videoData?.cover?.url_list?.[0] ||
        videoData?.origin_cover?.url_list?.[0] ||
        videoData?.dynamic_cover?.url_list?.[0] ||
        '',
      duration: this.formatDuration(videoData?.duration || 0),
      platform: 'douyin',
      author: detail?.author?.nickname || '',
      description: detail?.desc || '',
      sourceUrl: `https://www.douyin.com/video/${videoId}`,
      videoUrl:
        this.pickTopVideoUrlFromMap(downloadOptions?.merged) ||
        this.getBestQualityUrl(videoData?.play_addr?.url_list || []),
      audioUrl:
        musicData?.play_url?.url_info?.[0]?.url ||
        musicData?.play_url?.url_list?.[0] ||
        '',
      downloadOptions,
    };
  }

  private buildDownloadOptionsFromDouyinVideo(
    videoData: any,
  ): VideoDownloadOptions | undefined {
    if (!videoData) {
      return undefined;
    }

    const mergedByQuality = new Map<
      string,
      { candidate: VideoStreamCandidate; score: number }
    >();
    const candidatesByQuality = new Map<
      string,
      Array<{ candidate: VideoStreamCandidate; score: number }>
    >();
    const upsert = (
      quality: string,
      rawUrl: string,
      score: number,
      metadata: {
        width?: number;
        height?: number;
        bandwidth?: number;
        frameRate?: number;
        sourceKind: string;
        watermark?: boolean;
      },
    ) => {
      const normalizedQuality = this.normalizeVideoQualityLabel(quality);
      const url = this.extractPlayableUrl(rawUrl);
      if (!normalizedQuality || !url) {
        return;
      }

      const normalizedUrl = this.normalizeDouyinVideoUrl(url);
      const candidate = this.createVideoCandidate({
        url: normalizedUrl,
        quality: normalizedQuality,
        width: metadata.width,
        height: metadata.height,
        bandwidth: metadata.bandwidth,
        frameRate: metadata.frameRate,
        sourceKind: metadata.sourceKind,
        watermark: metadata.watermark,
      });

      const rankedCandidates = candidatesByQuality.get(normalizedQuality) || [];
      const candidateIdentity = this.getCandidateIdentity(candidate);
      const existingIndex = rankedCandidates.findIndex(
        (item) => this.getCandidateIdentity(item.candidate) === candidateIdentity,
      );
      if (existingIndex >= 0) {
        if (score > rankedCandidates[existingIndex].score) {
          rankedCandidates[existingIndex] = { candidate, score };
        }
      } else {
        rankedCandidates.push({ candidate, score });
      }
      candidatesByQuality.set(normalizedQuality, rankedCandidates);

      const current = mergedByQuality.get(normalizedQuality);
      if (!current || this.compareRankedCandidates(score, candidate, current) < 0) {
        mergedByQuality.set(normalizedQuality, {
          candidate,
          score,
        });
      }
    };

    const bitRates = Array.isArray(videoData?.bit_rate) ? videoData.bit_rate : [];
    for (const item of bitRates) {
      const playAddr = item?.play_addr || {};
      const mergedUrl = this.getBestQualityUrl(playAddr?.url_list || []);
      const inferredQuality = this.inferDouyinVideoQuality(
        mergedUrl,
        Number(playAddr?.width) || 0,
        Number(playAddr?.height) || 0,
        item?.gear_name,
      );
      const score =
        10_000 +
        Number(item?.bit_rate || 0) +
        Number(item?.FPS || 0) * 1000 +
        this.referenceResolution(
          Number(playAddr?.width) || 0,
          Number(playAddr?.height) || 0,
        ) *
          10 +
        Number(playAddr?.data_size || 0) / 1000;
      upsert(inferredQuality, mergedUrl, score, {
        width: Number(playAddr?.width) || 0,
        height: Number(playAddr?.height) || 0,
        bandwidth: Number(item?.bit_rate || 0) || 0,
        frameRate: Number(item?.FPS || 0) || 0,
        sourceKind: 'bit_rate',
      });
    }

    const playCandidates = [
      { addr: videoData?.play_addr, score: 1000 },
      { addr: videoData?.play_addr_h264, score: 1500 },
      { addr: videoData?.play_addr_bytevc1, score: 1400 },
    ];

    for (const candidate of playCandidates) {
      const playAddr = candidate.addr || {};
      const mergedUrl = this.getBestQualityUrl(playAddr?.url_list || []);
      const inferredQuality = this.inferDouyinVideoQuality(
        mergedUrl,
        Number(playAddr?.width) || Number(videoData?.width) || 0,
        Number(playAddr?.height) || Number(videoData?.height) || 0,
        '',
      );
      const score =
        candidate.score +
        Number(playAddr?.data_size || 0) / 1000 +
        this.referenceResolution(
          Number(playAddr?.width) || Number(videoData?.width) || 0,
          Number(playAddr?.height) || Number(videoData?.height) || 0,
        ) *
          10;
      upsert(inferredQuality, mergedUrl, score, {
        width: Number(playAddr?.width) || Number(videoData?.width) || 0,
        height: Number(playAddr?.height) || Number(videoData?.height) || 0,
        bandwidth: Number(playAddr?.data_size || 0) || 0,
        frameRate: 0,
        sourceKind:
          candidate.addr === videoData?.play_addr_h264
            ? 'play_addr_h264'
            : candidate.addr === videoData?.play_addr_bytevc1
              ? 'play_addr_bytevc1'
              : 'play_addr',
      });
    }

    const downloadAddr = videoData?.download_addr || {};
    const watermarkUrl = this.getBestQualityUrl(downloadAddr?.url_list || []);
    const inferredWatermarkQuality = this.inferDouyinVideoQuality(
      watermarkUrl,
      Number(downloadAddr?.width) || Number(videoData?.width) || 0,
      Number(downloadAddr?.height) || Number(videoData?.height) || 0,
      '',
    );
    const watermarkScore =
      200 +
      Number(downloadAddr?.data_size || 0) / 1000 +
      this.referenceResolution(
        Number(downloadAddr?.width) || Number(videoData?.width) || 0,
        Number(downloadAddr?.height) || Number(videoData?.height) || 0,
      ) *
        10;
    upsert(inferredWatermarkQuality, watermarkUrl, watermarkScore, {
      width: Number(downloadAddr?.width) || Number(videoData?.width) || 0,
      height: Number(downloadAddr?.height) || Number(videoData?.height) || 0,
      bandwidth: Number(downloadAddr?.data_size || 0) || 0,
      frameRate: 0,
      sourceKind: 'download_addr',
      watermark: true,
    });

    const merged = Array.from(mergedByQuality.entries()).reduce(
      (acc, [quality, value]) => {
        acc[quality] = value.candidate.url;
        return acc;
      },
      {} as Record<string, string>,
    );
    const videoCandidates = Array.from(candidatesByQuality.entries()).reduce(
      (acc, [quality, items]) => {
        acc[quality] = items
          .sort((left, right) =>
            this.compareRankedCandidates(left.score, left.candidate, right),
          )
          .map((item) => item.candidate);
        return acc;
      },
      {} as Record<string, VideoStreamCandidate[]>,
    );

    if (Object.keys(merged).length === 0 && Object.keys(videoCandidates).length === 0) {
      return undefined;
    }

    return {
      ...(Object.keys(merged).length > 0 ? { merged } : {}),
      ...(Object.keys(videoCandidates).length > 0 ? { videoCandidates } : {}),
    };
  }

  private createVideoCandidate(input: {
    url: string;
    quality: string;
    width?: number;
    height?: number;
    bandwidth?: number;
    frameRate?: number;
    sourceKind: string;
    watermark?: boolean;
  }): VideoStreamCandidate {
    const normalizedUrl = this.normalizeDouyinVideoUrl(input.url);
    const width = Math.max(0, Math.round(Number(input.width) || 0));
    const height = Math.max(0, Math.round(Number(input.height) || 0));
    const bandwidth = Math.max(0, Math.round(Number(input.bandwidth) || 0));
    const frameRate = Math.max(0, Math.round(Number(input.frameRate) || 0));
    const candidate: VideoStreamCandidate = {
      url: normalizedUrl,
      fileId: this.extractCandidateIdentity(normalizedUrl),
      ratio: input.quality,
      sourceKind: String(input.sourceKind || '').trim() || 'unknown',
    };
    if (width > 0) {
      candidate.width = width;
    }
    if (height > 0) {
      candidate.height = height;
    }
    if (bandwidth > 0) {
      candidate.bandwidth = bandwidth;
    }
    if (frameRate > 0) {
      candidate.frameRate = frameRate;
    }
    if (input.watermark === true) {
      candidate.watermark = true;
    }
    return candidate;
  }

  private compareRankedCandidates(
    leftScore: number,
    leftCandidate: VideoStreamCandidate,
    right:
      | { candidate: VideoStreamCandidate; score: number }
      | VideoStreamCandidate,
  ): number {
    const rightCandidate =
      'candidate' in right ? right.candidate : right;
    const rightScore =
      'score' in right ? right.score : 0;
    const sourceGap =
      this.getSourcePriority(leftCandidate.sourceKind) -
      this.getSourcePriority(rightCandidate.sourceKind);
    if (sourceGap !== 0) {
      return sourceGap;
    }
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    const resolutionGap =
      (Number(rightCandidate.width) || 0) * (Number(rightCandidate.height) || 0) -
      (Number(leftCandidate.width) || 0) * (Number(leftCandidate.height) || 0);
    if (resolutionGap !== 0) {
      return resolutionGap;
    }
    return (Number(rightCandidate.bandwidth) || 0) - (Number(leftCandidate.bandwidth) || 0);
  }

  private getSourcePriority(sourceKind?: string): number {
    switch (String(sourceKind || '').trim()) {
      case 'bit_rate':
        return 0;
      case 'play_addr_h264':
        return 1;
      case 'play_addr_bytevc1':
        return 2;
      case 'play_addr':
        return 3;
      case 'download_addr':
        return 4;
      case 'merged_fallback':
        return 5;
      case 'default_preview':
        return 6;
      default:
        return 7;
    }
  }

  private extractCandidateIdentity(url: string): string {
    try {
      const parsed = new URL(url);
      return (
        parsed.searchParams.get('file_id') ||
        parsed.pathname.split('/').filter(Boolean).pop() ||
        parsed.toString()
      );
    } catch (_error) {
      const matched = url.match(/[?&]file_id=([^&#]+)/i);
      if (matched?.[1]) {
        return decodeURIComponent(matched[1]);
      }
      const pathMatched = url.match(/\/([^/?#]+)(?:\?|#|$)/);
      return pathMatched?.[1] || url;
    }
  }

  private getCandidateIdentity(candidate: VideoStreamCandidate): string {
    return String(candidate.fileId || '').trim() || candidate.url;
  }

  private inferDouyinVideoQuality(
    url: string,
    width: number,
    height: number,
    gearName?: string,
  ): string {
    return (
      this.extractQualityFromDouyinPlayUrl(url) ||
      this.extractQualityFromGearName(gearName) ||
      this.mapDimensionsToQuality(width, height) ||
      ''
    );
  }

  private extractQualityFromDouyinPlayUrl(url: string): string {
    if (!url) {
      return '';
    }

    try {
      const parsed = new URL(url);
      const ratioValue =
        parsed.searchParams.get('ratio') || parsed.searchParams.get('radio');
      return this.normalizeVideoQualityLabel(ratioValue || '');
    } catch (_error) {
      const matched = url.match(/[?&](?:ratio|radio)=([^&#]+)/i);
      return this.normalizeVideoQualityLabel(matched?.[1] || '');
    }
  }

  private extractQualityFromGearName(gearName?: string): string {
    if (!gearName) {
      return '';
    }

    const matched = String(gearName)
      .toLowerCase()
      .match(/(2160|1440|1080|720|540|480|360|4k)/);
    if (!matched?.[1]) {
      return '';
    }

    return this.normalizeVideoQualityLabel(matched[1]);
  }

  private normalizeVideoQualityLabel(raw: string): string {
    const lower = String(raw || '').trim().toLowerCase();
    if (!lower) {
      return '';
    }
    if (lower.includes('4k') || lower.includes('2160')) {
      return '4k';
    }

    const matched = lower.match(/(2160|1440|1080|720|540|480|360)p?/);
    if (!matched?.[1]) {
      return '';
    }
    return this.mapResolutionToQuality(Number(matched[1]));
  }

  private mapDimensionsToQuality(width: number, height: number): string {
    return this.mapResolutionToQuality(this.referenceResolution(width, height));
  }

  private referenceResolution(width: number, height: number): number {
    const values = [Number(width) || 0, Number(height) || 0].filter(
      (value) => value > 0,
    );
    if (values.length >= 2) {
      return Math.min(...values);
    }
    return values[0] || 0;
  }

  private mapResolutionToQuality(value: number): string {
    if (value >= 2160) {
      return '4k';
    }
    if (value >= 1440) {
      return '1440p';
    }
    if (value >= 1080) {
      return '1080p';
    }
    if (value >= 720) {
      return '720p';
    }
    if (value >= 540) {
      return '540p';
    }
    if (value >= 480) {
      return '480p';
    }
    if (value >= 360) {
      return '360p';
    }
    return '';
  }

  private normalizeDouyinVideoUrl(url: string): string {
    if (!url) {
      return '';
    }
    if (/[?&]watermark=1(?:&|$)/i.test(url)) {
      return url;
    }
    return url.replace('/aweme/v1/playwm/', '/aweme/v1/play/');
  }

  private extractPlayableUrl(url?: string): string {
    if (!url || !/^https?:\/\//i.test(url)) {
      return '';
    }
    return url;
  }

  private getBestQualityUrl(urlList: string[]): string {
    if (!Array.isArray(urlList) || urlList.length === 0) {
      return '';
    }
    let bestUrl = '';
    let bestScore = Number.POSITIVE_INFINITY;

    for (const item of urlList) {
      const normalized = this.normalizeDouyinVideoUrl(item);
      if (!normalized) {
        continue;
      }

      const score = this.getOfficialUrlPriority(normalized);
      if (score < bestScore) {
        bestUrl = normalized;
        bestScore = score;
      }
    }

    return bestUrl;
  }

  private getOfficialUrlPriority(url: string): number {
    let score = 0;
    if (this.isDouyinPlayLikeUrl(url)) {
      score += 100;
    }
    if (/[?&]watermark=1(?:&|$)/i.test(url)) {
      score += 50;
    }

    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname === 'www.douyin.com') {
        score += 25;
      } else if (hostname.includes('douyin.com')) {
        score += 10;
      }
    } catch (_error) {
      // ignore malformed urls and keep base score
    }

    return score;
  }

  private isDouyinPlayLikeUrl(url: string): boolean {
    return /\/aweme\/v1\/play(?:wm)?\//i.test(String(url || ''));
  }

  private pickTopVideoUrlFromMap(qualityMap?: Record<string, string>): string {
    if (!qualityMap) {
      return '';
    }

    const order = ['4k', '1440p', '1080p', '720p', '540p', '480p', '360p'];
    for (const quality of order) {
      if (qualityMap[quality]) {
        return qualityMap[quality];
      }
    }

    return Object.values(qualityMap)[0] || '';
  }

  private formatDuration(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const two = (value: number) => String(value).padStart(2, '0');
    if (hours > 0) {
      return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
    }
    return `${two(minutes)}:${two(seconds)}`;
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
