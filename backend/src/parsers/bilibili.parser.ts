import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { VideoParser, VideoInfo, VideoStreamCandidate } from './base.interface';
import { BilibiliAuthService } from '../bilibili-auth/bilibili-auth.service';

type QualityLabel = '360p' | '480p' | '720p' | '1080p' | '4k';

interface BilibiliStream {
  id?: number;
  bandwidth?: number;
  width?: number;
  height?: number;
  frameRate?: string | number;
  frame_rate?: string | number;
  codecid?: number;
  baseUrl?: string;
  base_url?: string;
  url?: string;
  backupUrl?: string[];
  backup_url?: string[];
}

interface PlayUrlData {
  dash?: {
    video?: BilibiliStream[];
    audio?: BilibiliStream[];
  };
  durl?: Array<{ url?: string }>;
  quality?: number;
  accept_quality?: number[];
}

interface PlaybackSources {
  previewUrl: string;
  audioUrl: string;
  downloadOptions?: VideoInfo['downloadOptions'];
}

/**
 * B站视频解析器
 * 支持多种URL格式：
 * - https://www.bilibili.com/video/BVxxxxx
 * - https://www.bilibili.com/video/avxxxxx
 * - https://b23.tv/xxxxx (短链接)
 */
@Injectable()
export class BilibiliParser implements VideoParser {
  private readonly logger = new Logger(BilibiliParser.name);
  platform: VideoInfo['platform'] = 'bilibili';

  private readonly previewQualityOrder: QualityLabel[] = ['720p', '1080p', '480p', '360p', '4k'];
  private readonly playbackFetchConcurrency = 3;

  constructor(private readonly bilibiliAuthService: BilibiliAuthService) {}

  /**
   * 判断是否支持该URL
   */
  supports(url: string): boolean {
    return (
      url.includes('bilibili.com') ||
      url.includes('b23.tv') ||
      url.includes('bilibili.tv')
    );
  }

  /**
   * 解析视频信息
   */
  async parse(url: string): Promise<VideoInfo> {
    const parseStartedAt = Date.now();
    const stageTimings = {
      resolveShortUrlMs: 0,
      fetchViewMs: 0,
      playbackMs: 0,
    };
    let bvid = '';
    let aid: number | undefined;
    let cid: number | undefined;
    let parseSucceeded = false;

    try {
      // 处理短链接，先获取真实URL
      if (url.includes('b23.tv')) {
        const resolveStartedAt = Date.now();
        url = await this.resolveShortUrl(url);
        stageTimings.resolveShortUrlMs = Date.now() - resolveStartedAt;
      }

      // 提取BV号
      bvid = this.extractBVId(url);
      if (!bvid) {
        throw new Error('无法从URL中提取BV号');
      }

      // 调用B站API获取视频信息
      const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
      const bilibiliCookie = await this.getBilibiliCookieHeader();
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://www.bilibili.com',
      };
      if (bilibiliCookie) {
        headers.Cookie = bilibiliCookie;
      }
      const fetchViewStartedAt = Date.now();
      const response = await axios.get(apiUrl, {
        headers,
        timeout: 10000,
      });
      stageTimings.fetchViewMs = Date.now() - fetchViewStartedAt;

      if (response.data.code !== 0) {
        throw new Error(`B站API返回错误: ${response.data.message}`);
      }

      const data = response.data.data;
      aid = data.aid;
      cid = data.cid;

      // 格式化时长
      const duration = this.formatDuration(data.duration);

      // 获取可播放/可下载流信息
      const playbackStartedAt = Date.now();
      const playback = await this.getPlaybackSources(data.aid, data.cid);
      stageTimings.playbackMs = Date.now() - playbackStartedAt;

      // 处理封面图片URL - 使用 https 协议和正确的 CDN 域名
      let coverUrl = '';
      if (data.pic) {
        // 去除 http: 前缀，统一使用 https
        let picUrl = data.pic.startsWith('http') ? data.pic : `https:${data.pic}`;
        if (picUrl.includes('hdslb.com')) {
          picUrl = picUrl.replace(/http:\/\/i\d+\.hdslb\.com/, 'https://i0.hdslb.com');
        }
        coverUrl = picUrl;
      }

      const result: VideoInfo = {
        title: data.title,
        cover: coverUrl,
        duration,
        platform: 'bilibili',
        author: data.owner ? data.owner.name : '',
        description: data.desc || '',
        videoUrl: playback.previewUrl,
        audioUrl: playback.audioUrl,
        downloadOptions: playback.downloadOptions,
      };

      parseSucceeded = true;
      return result;
    } catch (error) {
      this.logger.error(`B站视频解析失败: ${error.message}`);
      throw error;
    } finally {
      this.logger.log(
        JSON.stringify({
          event: 'bilibili_parse_timing',
          success: parseSucceeded,
          bvid,
          aid,
          cid,
          totalMs: Date.now() - parseStartedAt,
          stages: stageTimings,
        }),
      );
    }
  }

  /**
   * 解析短链接
   */
  private async resolveShortUrl(shortUrl: string): Promise<string> {
    try {
      const response = await axios.get(shortUrl, {
        maxRedirects: 0,
        timeout: 10000,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      return this.extractResolvedShortUrl(shortUrl, response) || shortUrl;
    } catch (error: any) {
      const resolvedUrl = this.extractResolvedShortUrl(shortUrl, error);
      if (resolvedUrl) {
        return resolvedUrl;
      }

      this.logger.warn(`短链接解析失败: ${error.message}`);
      return shortUrl;
    }
  }

  private extractResolvedShortUrl(baseUrl: string, payload: any): string | null {
    const location = payload?.response?.headers?.location || payload?.headers?.location;
    if (typeof location === 'string' && location.trim()) {
      try {
        return new URL(location, baseUrl).toString();
      } catch {
        return location;
      }
    }

    const responseUrl = payload?.request?.res?.responseUrl;
    if (typeof responseUrl === 'string' && responseUrl.trim()) {
      return responseUrl;
    }

    return null;
  }

  /**
   * 从URL中提取BV号
   */
  private extractBVId(url: string): string | null {
    // 匹配 BVxxxxx 格式
    const bvMatch = url.match(/BV[\w]+/i);
    if (bvMatch) {
      return bvMatch[0];
    }

    // 匹配 avxxxxx 格式
    const avMatch = url.match(/av(\d+)/i);
    if (avMatch) {
      return this.avToBv(parseInt(avMatch[1], 10));
    }

    return null;
  }

  /**
   * AV号转BV号
   */
  private avToBv(av: number): string {
    const table = 'fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF';
    const tr = {};
    for (let i = 0; i < 58; i++) {
      tr[table[i]] = i;
    }
    const s = [11, 10, 3, 8, 4, 6];
    const xor = 177451812;
    const add = 8728348608;
    let id = (av ^ xor) + add;
    const result = ['B', 'V', '', '', '', '', '', '', '', '', ''];
    for (let i = 0; i < 6; i++) {
      result[s[i]] = table[Math.floor(id % 58)];
      id = Math.floor(id / 58);
    }
    return result.join('');
  }

  /**
   * 格式化时长（秒转换为 mm:ss 格式）
   */
  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  /**
   * 获取预览与下载可用流
   */
  private async getPlaybackSources(aid: number, cid: number): Promise<PlaybackSources> {
    const dashData = await this.fetchPlayUrlData(aid, cid, {
      qn: 120,
      fourk: 1,
      fnval: 4048,
      fnver: 0,
      otype: 'json',
    });

    if (!dashData) {
      return {
        previewUrl: '',
        audioUrl: '',
      };
    }

    const initialDashVideos = dashData.dash?.video || [];
    const initialVideoByQuality = this.buildDashVideoMap(initialDashVideos);
    const videoCandidatesByQuality = this.buildDashVideoCandidateMap(
      initialDashVideos,
    );
    const videoByQuality = await this.expandDashVideoMapByQuality(
      aid,
      cid,
      dashData.accept_quality || [],
      initialVideoByQuality,
      videoCandidatesByQuality,
    );
    const videoCandidates = this.hydrateVideoCandidatesByVideoMap(
      videoByQuality,
      videoCandidatesByQuality,
    );
    const qualityLabels = this.getAvailableQualityLabels(
      dashData.accept_quality || [],
      videoByQuality,
    );

    const audioByQuality = this.buildDashAudioMap(dashData.dash?.audio || []);
    const audioUrl = this.getPreferredAudioUrl(audioByQuality);

    const mergedByQuality = await this.buildMergedQualityMap(
      aid,
      cid,
      dashData.accept_quality || [],
      qualityLabels,
    );

    const previewUrl =
      this.pickPreferredQualityUrl(videoByQuality) ||
      this.pickPreferredQualityUrl(mergedByQuality) ||
      dashData.durl?.[0]?.url ||
      '';

    return {
      previewUrl,
      audioUrl,
      downloadOptions: {
        merged: Object.keys(mergedByQuality).length > 0 ? mergedByQuality : undefined,
        video: Object.keys(videoByQuality).length > 0 ? videoByQuality : undefined,
        videoCandidates:
          Object.keys(videoCandidates).length > 0
            ? videoCandidates
            : undefined,
        audio: Object.keys(audioByQuality).length > 0 ? audioByQuality : undefined,
      },
    };
  }

  private async expandDashVideoMapByQuality(
    aid: number,
    cid: number,
    acceptQuality: number[],
    initialMap: Record<string, string>,
    candidateMap?: Record<string, VideoStreamCandidate[]>,
  ): Promise<Record<string, string>> {
    const expandedMap: Record<string, string> = {
      ...initialMap,
    };

    const qualityLabels = this.getAvailableQualityLabels(acceptQuality, expandedMap).filter(
      (label) => !expandedMap[label],
    );
    const fetchResults = await this.mapWithConcurrency(
      qualityLabels,
      async (label) => {
        const qn = this.getPreferredQnForQuality(label, acceptQuality);
        if (!qn) {
          return null;
        }

        const qualityData = await this.fetchPlayUrlData(aid, cid, {
          qn,
          fourk: 1,
          fnval: 4048,
          fnver: 0,
          otype: 'json',
        });
        const qualityDashVideos = qualityData?.dash?.video || [];

        return {
          label,
          qn,
          qualityVideoMap: this.buildDashVideoMap(qualityDashVideos),
          qualityCandidateMap: candidateMap
            ? this.buildDashVideoCandidateMap(qualityDashVideos)
            : undefined,
        };
      },
      this.playbackFetchConcurrency,
    );

    fetchResults.forEach((result) => {
      if (!result) {
        return;
      }

      if (candidateMap && result.qualityCandidateMap) {
        this.mergeVideoCandidateMap(candidateMap, result.qualityCandidateMap);
      }

      const exactByLabel = result.qualityVideoMap[result.label];
      const exactByQn = result.qualityVideoMap[this.mapQnToQuality(result.qn)];
      const targetUrl = exactByLabel || exactByQn;

      if (targetUrl && !expandedMap[result.label]) {
        expandedMap[result.label] = targetUrl;
      }
    });

    return expandedMap;
  }

  private mergeVideoCandidateMap(
    target: Record<string, VideoStreamCandidate[]>,
    source: Record<string, VideoStreamCandidate[]>,
  ): void {
    Object.entries(source).forEach(([quality, incomingCandidates]) => {
      const merged = [...(target[quality] || []), ...(incomingCandidates || [])];
      const dedupByUrl = new Map<string, VideoStreamCandidate>();
      merged.forEach((item) => {
        const url = String(item?.url || '').trim();
        if (!url || dedupByUrl.has(url)) {
          return;
        }
        dedupByUrl.set(url, item);
      });
      target[quality] = Array.from(dedupByUrl.values());
    });
  }

  private hydrateVideoCandidatesByVideoMap(
    videoMap: Record<string, string>,
    candidateMap: Record<string, VideoStreamCandidate[]>,
  ): Record<string, VideoStreamCandidate[]> {
    const hydrated: Record<string, VideoStreamCandidate[]> = {};

    Object.entries(candidateMap).forEach(([quality, candidates]) => {
      hydrated[quality] = [...candidates];
    });

    Object.entries(videoMap).forEach(([quality, url]) => {
      const list = hydrated[quality] || [];
      const exists = list.some((item) => item.url === url);
      if (!exists && url) {
        list.push({ url });
      }
      hydrated[quality] = list;
    });

    return hydrated;
  }

  private async fetchPlayUrlData(
    aid: number,
    cid: number,
    params: Record<string, string | number>,
  ): Promise<PlayUrlData | null> {
    try {
      const bilibiliCookie = await this.getBilibiliCookieHeader();
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://www.bilibili.com',
      };
      if (bilibiliCookie) {
        headers.Cookie = bilibiliCookie;
      }

      const response = await axios.get('https://api.bilibili.com/x/player/playurl', {
        params: {
          avid: aid,
          cid,
          ...params,
        },
        headers,
        timeout: 10000,
      });

      if (response.data?.code !== 0) {
        this.logger.warn(`B站播放地址API返回错误: ${response.data?.message || 'unknown'}`);
        return null;
      }

      return response.data?.data || null;
    } catch (error) {
      this.logger.warn(`调用B站播放地址API失败: ${error.message}`);
      return null;
    }
  }

  private normalizeStreamUrl(stream: BilibiliStream): string {
    return (
      stream.baseUrl ||
      stream.base_url ||
      stream.url ||
      stream.backupUrl?.[0] ||
      stream.backup_url?.[0] ||
      ''
    );
  }

  private normalizeVideoQn(rawQn: number): number {
    if (!rawQn || Number.isNaN(rawQn)) {
      return 0;
    }

    const knownQn = [127, 126, 125, 120, 116, 112, 80, 74, 64, 32, 16];
    if (knownQn.includes(rawQn)) {
      return rawQn;
    }

    const qnByMod1000 = rawQn % 1000;
    if (knownQn.includes(qnByMod1000)) {
      return qnByMod1000;
    }

    const qnByMod100 = rawQn % 100;
    if (knownQn.includes(qnByMod100)) {
      return qnByMod100;
    }

    const rawText = String(rawQn);
    const matched = knownQn.find((candidate) => rawText.endsWith(String(candidate)));
    return matched || rawQn;
  }

  private mapQnToQuality(qn: number): QualityLabel {
    const normalizedQn = this.normalizeVideoQn(qn);

    if (normalizedQn >= 120) {
      return '4k';
    }

    if (normalizedQn >= 80) {
      return '1080p';
    }

    if (normalizedQn >= 64) {
      return '720p';
    }

    if (normalizedQn >= 32) {
      return '480p';
    }

    return '360p';
  }

  private buildDashVideoMap(streams: BilibiliStream[]): Record<string, string> {
    const bestByQuality: Record<
      string,
      { url: string; bandwidth: number; pixelCount: number; frameRate: number }
    > = {};

    streams.forEach((stream) => {
      const url = this.normalizeStreamUrl(stream);
      if (!url) {
        return;
      }

      const quality = this.mapQnToQuality(stream.id || 0);
      const bandwidth = stream.bandwidth || 0;
      const width = Number(stream.width || 0);
      const height = Number(stream.height || 0);
      const pixelCount = width * height;
      const frameRate = this.parseFrameRate(
        stream.frameRate || stream.frame_rate,
      );
      const current = bestByQuality[quality];

      const shouldReplace =
        !current ||
        pixelCount > current.pixelCount ||
        (pixelCount === current.pixelCount && frameRate > current.frameRate) ||
        (pixelCount === current.pixelCount &&
          frameRate === current.frameRate &&
          bandwidth > current.bandwidth);

      if (shouldReplace) {
        bestByQuality[quality] = { url, bandwidth, pixelCount, frameRate };
      }
    });

    return Object.entries(bestByQuality).reduce((acc, [quality, item]) => {
      acc[quality] = item.url;
      return acc;
    }, {} as Record<string, string>);
  }

  private parseFrameRate(raw: string | number | undefined): number {
    if (raw === undefined || raw === null) {
      return 0;
    }

    const text = String(raw).trim();
    if (!text) {
      return 0;
    }

    if (text.includes('/')) {
      const [numeratorText, denominatorText] = text.split('/');
      const numerator = Number(numeratorText);
      const denominator = Number(denominatorText);
      if (
        Number.isFinite(numerator) &&
        Number.isFinite(denominator) &&
        denominator > 0
      ) {
        return numerator / denominator;
      }
    }

    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
  }

  private buildDashVideoCandidateMap(
    streams: BilibiliStream[],
  ): Record<string, VideoStreamCandidate[]> {
    const candidateMap: Record<string, VideoStreamCandidate[]> = {};

    streams.forEach((stream) => {
      const url = this.normalizeStreamUrl(stream);
      if (!url) {
        return;
      }

      const quality = this.mapQnToQuality(stream.id || 0);
      const width = Number(stream.width || 0);
      const height = Number(stream.height || 0);
      const frameRate = this.parseFrameRate(
        stream.frameRate || stream.frame_rate,
      );
      const bandwidth = Number(stream.bandwidth || 0);

      candidateMap[quality] ||= [];
      candidateMap[quality].push({
        url,
        codecid: Number.isFinite(stream.codecid) ? stream.codecid : undefined,
        width,
        height,
        frameRate,
        bandwidth,
      });
    });

    Object.keys(candidateMap).forEach((quality) => {
      const dedupByUrl = new Map<string, VideoStreamCandidate>();
      candidateMap[quality].forEach((item) => {
        const normalizedUrl = String(item.url || '').trim();
        if (!normalizedUrl || dedupByUrl.has(normalizedUrl)) {
          return;
        }
        dedupByUrl.set(normalizedUrl, item);
      });

      candidateMap[quality] = Array.from(dedupByUrl.values()).sort((left, right) => {
        const leftPixel = Number(left.width || 0) * Number(left.height || 0);
        const rightPixel = Number(right.width || 0) * Number(right.height || 0);
        if (rightPixel !== leftPixel) {
          return rightPixel - leftPixel;
        }

        const leftCodecPriority = this.getIosCodecPriority(left.codecid);
        const rightCodecPriority = this.getIosCodecPriority(right.codecid);
        if (rightCodecPriority !== leftCodecPriority) {
          return rightCodecPriority - leftCodecPriority;
        }

        const frameRateDiff = Number(right.frameRate || 0) - Number(left.frameRate || 0);
        if (frameRateDiff !== 0) {
          return frameRateDiff;
        }

        return Number(right.bandwidth || 0) - Number(left.bandwidth || 0);
      });

      // 仅保留有限候选，避免 parse payload 膨胀
      candidateMap[quality] = candidateMap[quality].slice(0, 6);
    });

    return candidateMap;
  }

  private getIosCodecPriority(codecid: number | undefined): number {
    if (!Number.isFinite(codecid)) {
      return 0;
    }

    if (codecid === 7) {
      return 100;
    }

    return 10;
  }

  private normalizeAudioQuality(stream: BilibiliStream): string {
    const byId: Record<number, string> = {
      30216: '64k',
      30232: '132k',
      30250: '80k',
      30280: '192k',
    };

    if (stream.id && byId[stream.id]) {
      return byId[stream.id];
    }

    const kbps = Math.round((stream.bandwidth || 0) / 1000);
    if (kbps <= 0) {
      return '128k';
    }

    if (kbps <= 80) {
      return '64k';
    }

    if (kbps <= 160) {
      return '132k';
    }

    return '192k';
  }

  private parseAudioQualityBitrate(quality: string): number {
    const matched = quality.toLowerCase().match(/(\d+)\s*k/);
    if (!matched) {
      return 0;
    }
    return parseInt(matched[1], 10);
  }

  private buildDashAudioMap(streams: BilibiliStream[]): Record<string, string> {
    const bestByQuality: Record<string, { url: string; bandwidth: number }> = {};

    streams.forEach((stream) => {
      const url = this.normalizeStreamUrl(stream);
      if (!url) {
        return;
      }

      const quality = this.normalizeAudioQuality(stream);
      const bandwidth = stream.bandwidth || 0;
      const current = bestByQuality[quality];

      if (!current || bandwidth > current.bandwidth) {
        bestByQuality[quality] = { url, bandwidth };
      }
    });

    const ordered = Object.entries(bestByQuality).sort((a, b) => {
      return this.parseAudioQualityBitrate(a[0]) - this.parseAudioQualityBitrate(b[0]);
    });

    return ordered.reduce((acc, [quality, item]) => {
      acc[quality] = item.url;
      return acc;
    }, {} as Record<string, string>);
  }

  private getPreferredAudioUrl(audioMap: Record<string, string>): string {
    const ordered = Object.keys(audioMap).sort((a, b) => {
      return this.parseAudioQualityBitrate(b) - this.parseAudioQualityBitrate(a);
    });

    if (ordered.length === 0) {
      return '';
    }

    return audioMap[ordered[0]] || '';
  }

  private getAvailableQualityLabels(
    acceptQuality: number[],
    videoMap: Record<string, string>,
  ): QualityLabel[] {
    const labelSet = new Set<QualityLabel>();

    Object.keys(videoMap).forEach((quality) => {
      labelSet.add(quality as QualityLabel);
    });

    acceptQuality.forEach((qn) => {
      labelSet.add(this.mapQnToQuality(qn));
    });

    if (labelSet.size === 0) {
      return ['720p'];
    }

    const ordered: QualityLabel[] = ['4k', '1080p', '720p', '480p', '360p'];
    return ordered.filter((label) => labelSet.has(label));
  }

  private getPreferredQnForQuality(
    label: QualityLabel,
    acceptQuality: number[],
  ): number | null {
    const preferredByQuality: Record<QualityLabel, number[]> = {
      '4k': [120],
      '1080p': [116, 112, 80],
      '720p': [74, 64],
      '480p': [32],
      '360p': [32, 16],
    };

    for (const qn of preferredByQuality[label]) {
      if (acceptQuality.includes(qn)) {
        return qn;
      }
    }

    if (acceptQuality.length === 0) {
      return null;
    }

    const sorted = [...acceptQuality].sort((a, b) => a - b);

    if (label === '4k') {
      return sorted[sorted.length - 1];
    }

    if (label === '360p') {
      return sorted[0];
    }

    const target = label === '1080p' ? 80 : label === '720p' ? 64 : 32;
    return sorted.reduce((best, current) => {
      const currentDistance = Math.abs(current - target);
      const bestDistance = Math.abs(best - target);
      return currentDistance < bestDistance ? current : best;
    }, sorted[0]);
  }

  private async getBilibiliCookieHeader(): Promise<string> {
    return this.bilibiliAuthService.getCookieHeader();
  }

  private async buildMergedQualityMap(
    aid: number,
    cid: number,
    acceptQuality: number[],
    qualityLabels: QualityLabel[],
  ): Promise<Record<string, string>> {
    const mergedMap: Record<string, string> = {};
    const seenUrls = new Set<string>();
    const fetchResults = await this.mapWithConcurrency(
      qualityLabels,
      async (label) => {
        const qn = this.getPreferredQnForQuality(label, acceptQuality);
        if (!qn) {
          return null;
        }

        const stream = await this.getProgressiveUrl(aid, cid, qn);
        return {
          label,
          qn,
          stream,
        };
      },
      this.playbackFetchConcurrency,
    );

    fetchResults.forEach((result) => {
      if (!result || !result.stream.url || seenUrls.has(result.stream.url)) {
        return;
      }

      const actualQuality = this.mapQnToQuality(result.stream.qualityQn || result.qn);
      if (!mergedMap[actualQuality]) {
        mergedMap[actualQuality] = result.stream.url;
        seenUrls.add(result.stream.url);
      }
    });

    return mergedMap;
  }

  private async mapWithConcurrency<TInput, TOutput>(
    items: TInput[],
    worker: (item: TInput, index: number) => Promise<TOutput>,
    concurrency: number,
  ): Promise<TOutput[]> {
    if (items.length === 0) {
      return [];
    }

    const results = new Array<TOutput>(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
      }),
    );

    return results;
  }

  /**
   * 获取带音频的直链（优先用于预览与 mp4 下载）
   */
  private async getProgressiveUrl(
    aid: number,
    cid: number,
    qn: number,
  ): Promise<{ url: string; qualityQn?: number }> {
    const paramCandidates: Array<Record<string, string | number>> = [
      { qn, fourk: 1, fnval: 0, fnver: 0, otype: 'json' },
      { qn, fourk: 1, fnval: 1, fnver: 0, otype: 'json' },
      { qn, fourk: 1, fnval: 0, fnver: 0, platform: 'html5', otype: 'json' },
    ];

    for (const params of paramCandidates) {
      const data = await this.fetchPlayUrlData(aid, cid, params);
      const durl = data?.durl?.[0]?.url;
      if (durl) {
        return {
          url: durl,
          qualityQn: data?.quality || qn,
        };
      }
    }

    return {
      url: '',
      qualityQn: qn,
    };
  }

  private pickPreferredQualityUrl(urlMap: Record<string, string>): string {
    if (!urlMap || Object.keys(urlMap).length === 0) {
      return '';
    }

    for (const quality of this.previewQualityOrder) {
      if (urlMap[quality]) {
        return urlMap[quality];
      }
    }

    return Object.values(urlMap)[0] || '';
  }
}
