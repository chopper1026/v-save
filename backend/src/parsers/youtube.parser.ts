import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { VideoDownloadOptions, VideoParser, VideoInfo } from './base.interface';
import { resolveBooleanFlag } from '../config/runtime-config';
import { resolveYtDlpPath } from '../config/executable-paths';

const execFileAsync = promisify(execFile);

type VideoQualityLabel = '360p' | '480p' | '720p' | '1080p' | '4k';
type AudioQualityLabel = '64k' | '132k' | '192k';

interface YtDlpFormat {
  url?: string;
  ext?: string;
  height?: number;
  tbr?: number;
  vbr?: number;
  abr?: number;
  filesize?: number;
  filesize_approx?: number;
  vcodec?: string;
  acodec?: string;
}

interface YtDlpPayload {
  formats?: YtDlpFormat[];
}

interface YtDlpStreamResult {
  downloadOptions?: VideoDownloadOptions;
  bestMergedUrl?: string;
  bestAudioUrl?: string;
}

/**
 * YouTube视频解析器
 * 支持多种URL格式：
 * - https://www.youtube.com/watch?v=xxxxx
 * - https://youtu.be/xxxxx
 * - https://www.youtube.com/shorts/xxxxx
 * - https://www.youtube.com/v/xxxxx
 */
@Injectable()
export class YoutubeParser implements VideoParser {
  private readonly logger = new Logger(YoutubeParser.name);
  private readonly noembedEnabled = resolveBooleanFlag(
    process.env.YOUTUBE_NOEMBED_ENABLED,
    true,
  );
  platform: VideoInfo['platform'] = 'youtube';

  /**
   * 判断是否支持该URL
   */
  supports(url: string): boolean {
    return (
      url.includes('youtube.com') ||
      url.includes('youtu.be') ||
      url.includes('y2u.be')
    );
  }

  /**
   * 解析视频信息
   */
  async parse(url: string): Promise<VideoInfo> {
    try {
      // 提取视频ID
      const videoId = this.extractVideoId(url);
      if (!videoId) {
        throw new Error('无法从URL中提取视频ID');
      }

      // 获取视频信息
      const videoInfo = await this.getVideoInfo(videoId);
      return videoInfo;
    } catch (error) {
      this.logger.error(`YouTube视频解析失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 从URL中提取视频ID
   */
  private extractVideoId(url: string): string | null {
    // 处理 youtu.be 短链接
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) {
      return shortMatch[1];
    }

    // 处理 /v/xxxxx 格式
    const vMatch = url.match(/\/v\/([a-zA-Z0-9_-]{11})/);
    if (vMatch) {
      return vMatch[1];
    }

    // 处理 /shorts/xxxxx 格式
    const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) {
      return shortsMatch[1];
    }

    // 处理 ?v=xxxxx 格式
    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) {
      return watchMatch[1];
    }

    return null;
  }

  /**
   * 获取视频信息
   */
  private async getVideoInfo(videoId: string): Promise<VideoInfo> {
    try {
      const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const ytDlpStreamsPromise = this.getYtDlpStreamOptions(pageUrl);

      let noembedData: any = null;
      if (this.noembedEnabled) {
        try {
          const noembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(pageUrl)}`;
          const noembedResponse = await axios.get(noembedUrl, {
            timeout: 10000,
          });
          if (noembedResponse.data?.title) {
            noembedData = noembedResponse.data;
          }
        } catch (error: any) {
          this.logger.warn(`noembed 不可用，改用页面解析: ${error?.message || 'unknown'}`);
        }
      }

      try {
        const pageResponse = await axios.get(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 10000,
        });

        const $ = cheerio.load(pageResponse.data);
        const scriptContent = $('script').filter((i, el) => {
          return $(el).html()?.includes('ytInitialPlayerResponse');
        }).first().html();

        if (scriptContent) {
          try {
            const jsonMatch = scriptContent.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/);
            if (jsonMatch) {
              const playerData = JSON.parse(jsonMatch[1]);
              const videoDetails = playerData?.videoDetails;

              if (videoDetails) {
                const duration = this.formatDuration(parseInt(videoDetails.lengthSeconds) || 0);
                const streamingData = playerData?.streamingData;
                const ytDlpStreams = await ytDlpStreamsPromise;
                const downloadOptions =
                  ytDlpStreams.downloadOptions ||
                  this.buildDownloadOptionsFromStreamingData(streamingData);
                const candidateVideoUrl = this.getBestVideoUrl(streamingData);
                const playableVideoUrl = await this.resolvePlayableVideoUrl(
                  pageUrl,
                  candidateVideoUrl,
                  ytDlpStreams.bestMergedUrl || '',
                );
                const audioUrl =
                  ytDlpStreams.bestAudioUrl || this.pickBestAudioUrl(downloadOptions);

                const result: VideoInfo = {
                  title: videoDetails.title || noembedData?.title || 'YouTube视频',
                  cover:
                    videoDetails.thumbnail?.thumbnails?.[0]?.url ||
                    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                  duration,
                  platform: 'youtube',
                  author: videoDetails.author || noembedData?.author_name || '',
                  description: videoDetails.shortDescription || '',
                  videoUrl: playableVideoUrl || candidateVideoUrl || pageUrl,
                };

                if (audioUrl) {
                  result.audioUrl = audioUrl;
                }
                if (downloadOptions) {
                  result.downloadOptions = downloadOptions;
                }

                return result;
              }
            }
          } catch (parseError: any) {
            this.logger.warn(`解析YouTube数据失败: ${parseError.message}`);
          }
        }
      } catch (error: any) {
        this.logger.warn(`YouTube 页面解析失败: ${error.message}`);
      }

      const ytDlpStreams = await ytDlpStreamsPromise;

      if (noembedData?.title) {
        const fallbackUrl = await this.resolvePlayableVideoUrl(
          pageUrl,
          '',
          ytDlpStreams.bestMergedUrl || '',
        );
        const result: VideoInfo = {
          title: noembedData.title,
          cover: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          duration: '00:00',
          platform: 'youtube',
          author: noembedData.author_name || '',
          description: '',
          videoUrl: fallbackUrl || pageUrl,
        };
        if (ytDlpStreams.bestAudioUrl) {
          result.audioUrl = ytDlpStreams.bestAudioUrl;
        }
        if (ytDlpStreams.downloadOptions) {
          result.downloadOptions = ytDlpStreams.downloadOptions;
        }
        return result;
      }

      const onlyUrlFallback = await this.resolvePlayableVideoUrl(
        pageUrl,
        '',
        ytDlpStreams.bestMergedUrl || '',
      );
      if (onlyUrlFallback) {
        const result: VideoInfo = {
          title: `YouTube 视频 ${videoId}`,
          cover: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          duration: '00:00',
          platform: 'youtube',
          author: '',
          description: '',
          videoUrl: onlyUrlFallback,
        };
        if (ytDlpStreams.bestAudioUrl) {
          result.audioUrl = ytDlpStreams.bestAudioUrl;
        }
        if (ytDlpStreams.downloadOptions) {
          result.downloadOptions = ytDlpStreams.downloadOptions;
        }
        return result;
      }

      throw new Error('无法获取视频信息');
    } catch (error) {
      this.logger.error(`获取YouTube视频信息失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取最高质量的视频URL
   */
  private getBestVideoUrl(streamingData: any): string {
    if (!streamingData) {
      return '';
    }

    // 优先选择 progressive 格式（自带音频，预览/下载兼容性更好）
    const formats = streamingData.formats || [];
    const adaptiveFormats = streamingData.adaptiveFormats || [];

    const sortedProgressive = formats
      .filter((f: any) => f.url || f.signatureCipher)
      .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));

    if (sortedProgressive.length > 0) {
      return this.resolveFormatUrl(sortedProgressive[0]);
    }

    const sortedAdaptive = adaptiveFormats
      .filter((f: any) => {
        const mimeType = String(f.mimeType || '').toLowerCase();
        return (f.url || f.signatureCipher) && mimeType.includes('video/');
      })
      .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));

    if (sortedAdaptive.length > 0) {
      return this.resolveFormatUrl(sortedAdaptive[0]);
    }

    return '';
  }

  private resolveFormatUrl(format: any): string {
    if (format?.url) {
      return format.url;
    }

    if (format?.signatureCipher) {
      try {
        const params = new URLSearchParams(format.signatureCipher);
        return params.get('url') || '';
      } catch {
        return '';
      }
    }

    return '';
  }

  private async resolvePlayableVideoUrl(
    pageUrl: string,
    candidateVideoUrl: string,
    ytDlpUrl?: string,
  ): Promise<string> {
    const preferredUrl = ytDlpUrl || await this.getPlayableVideoUrlByYtDlp(pageUrl);
    if (preferredUrl) {
      return preferredUrl;
    }

    if (await this.isPlayableVideoUrl(candidateVideoUrl)) {
      return candidateVideoUrl;
    }

    return candidateVideoUrl;
  }

  private buildDownloadOptionsFromStreamingData(
    streamingData: any,
  ): VideoDownloadOptions | undefined {
    if (!streamingData) {
      return undefined;
    }

    const formats = Array.isArray(streamingData.formats) ? streamingData.formats : [];
    const adaptiveFormats = Array.isArray(streamingData.adaptiveFormats)
      ? streamingData.adaptiveFormats
      : [];

    const merged: Record<string, string> = {};
    const video: Record<string, string> = {};
    const audio: Record<string, string> = {};

    const sortedFormats = formats
      .filter((item: any) => this.resolveFormatUrl(item))
      .sort((a: any, b: any) => this.getPlayerVideoScore(b) - this.getPlayerVideoScore(a));

    for (const format of sortedFormats) {
      const quality = this.mapHeightToVideoQuality(Number(format.height) || 0);
      const url = this.resolveFormatUrl(format);
      if (!quality || !url || merged[quality]) {
        continue;
      }
      merged[quality] = url;
    }

    const sortedVideoOnly = adaptiveFormats
      .filter((item: any) => {
        const mimeType = String(item.mimeType || '').toLowerCase();
        return mimeType.includes('video/') && this.resolveFormatUrl(item);
      })
      .sort((a: any, b: any) => this.getPlayerVideoScore(b) - this.getPlayerVideoScore(a));

    for (const format of sortedVideoOnly) {
      const quality = this.mapHeightToVideoQuality(Number(format.height) || 0);
      const url = this.resolveFormatUrl(format);
      if (!quality || !url || video[quality]) {
        continue;
      }
      video[quality] = url;
    }

    const sortedAudioOnly = adaptiveFormats
      .filter((item: any) => {
        const mimeType = String(item.mimeType || '').toLowerCase();
        return mimeType.includes('audio/') && this.resolveFormatUrl(item);
      })
      .sort((a: any, b: any) => this.getPlayerAudioScore(b) - this.getPlayerAudioScore(a));

    for (const format of sortedAudioOnly) {
      const quality = this.mapBitrateToAudioQuality(this.getPlayerAudioBitrate(format));
      const url = this.resolveFormatUrl(format);
      if (!quality || !url || audio[quality]) {
        continue;
      }
      audio[quality] = url;
    }

    const downloadOptions: VideoDownloadOptions = {};
    if (Object.keys(merged).length > 0) {
      downloadOptions.merged = merged;
    }
    if (Object.keys(video).length > 0) {
      downloadOptions.video = video;
    }
    if (Object.keys(audio).length > 0) {
      downloadOptions.audio = audio;
    }

    return Object.keys(downloadOptions).length > 0 ? downloadOptions : undefined;
  }

  private getPlayerVideoScore(format: any): number {
    const height = Number(format?.height) || 0;
    const bitrate = Number(format?.bitrate || format?.averageBitrate) || 0;
    const fps = Number(format?.fps) || 0;
    return height * 1000000 + bitrate * 100 + fps;
  }

  private getPlayerAudioScore(format: any): number {
    const bitrate = this.getPlayerAudioBitrate(format);
    return bitrate * 1000;
  }

  private getPlayerAudioBitrate(format: any): number {
    const directBitrate = Number(
      format?.bitrate || format?.averageBitrate || format?.audioBitrate,
    );
    if (Number.isFinite(directBitrate) && directBitrate > 0) {
      return directBitrate / 1000;
    }

    return 0;
  }

  private async getYtDlpStreamOptions(pageUrl: string): Promise<YtDlpStreamResult> {
    const ytDlpPath = this.resolveYtDlpPath();
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '-J',
      pageUrl,
    ];

    try {
      const { stdout } = await execFileAsync(ytDlpPath, args, {
        timeout: 25000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const payload = JSON.parse(stdout) as YtDlpPayload;
      return this.buildDownloadOptionsFromYtDlpPayload(payload);
    } catch (error: any) {
      this.logger.warn(`yt-dlp 获取格式列表失败: ${error?.message || 'unknown'}`);
      return {};
    }
  }

  private buildDownloadOptionsFromYtDlpPayload(payload: YtDlpPayload): YtDlpStreamResult {
    const formats = Array.isArray(payload?.formats) ? payload.formats : [];
    if (formats.length === 0) {
      return {};
    }

    const mergedByQuality = new Map<VideoQualityLabel, YtDlpFormat>();
    const videoByQuality = new Map<VideoQualityLabel, YtDlpFormat>();
    const audioByQuality = new Map<AudioQualityLabel, YtDlpFormat>();

    for (const format of formats) {
      const url = this.extractPlayableUrl(format.url);
      if (!url) {
        continue;
      }

      const formatWithUrl: YtDlpFormat = {
        ...format,
        url,
      };

      const hasVideo = this.hasMediaCodec(format.vcodec);
      const hasAudio = this.hasMediaCodec(format.acodec);

      if (hasVideo && hasAudio) {
        const quality = this.mapHeightToVideoQuality(Number(format.height) || 0);
        if (!quality) {
          continue;
        }

        const current = mergedByQuality.get(quality);
        if (this.shouldReplaceVideoCandidate(current, formatWithUrl)) {
          mergedByQuality.set(quality, formatWithUrl);
        }
        continue;
      }

      if (hasVideo && !hasAudio) {
        const quality = this.mapHeightToVideoQuality(Number(format.height) || 0);
        if (!quality) {
          continue;
        }

        const current = videoByQuality.get(quality);
        if (this.shouldReplaceVideoCandidate(current, formatWithUrl)) {
          videoByQuality.set(quality, formatWithUrl);
        }
        continue;
      }

      if (!hasVideo && hasAudio) {
        const quality = this.mapBitrateToAudioQuality(this.getYtDlpAudioBitrate(formatWithUrl));
        if (!quality) {
          continue;
        }

        const current = audioByQuality.get(quality);
        if (this.shouldReplaceAudioCandidate(current, formatWithUrl)) {
          audioByQuality.set(quality, formatWithUrl);
        }
      }
    }

    const merged = this.mapFormatMapToUrlMap(mergedByQuality);
    const video = this.mapFormatMapToUrlMap(videoByQuality);
    const audio = this.mapFormatMapToUrlMap(audioByQuality);

    const downloadOptions: VideoDownloadOptions = {};
    if (Object.keys(merged).length > 0) {
      downloadOptions.merged = merged;
    }
    if (Object.keys(video).length > 0) {
      downloadOptions.video = video;
    }
    if (Object.keys(audio).length > 0) {
      downloadOptions.audio = audio;
    }

    const bestMergedUrl =
      this.pickTopVideoUrl(merged) || this.pickTopVideoUrl(video);
    const bestAudioUrl = this.pickTopAudioUrl(audio);

    return {
      downloadOptions: Object.keys(downloadOptions).length > 0 ? downloadOptions : undefined,
      bestMergedUrl,
      bestAudioUrl,
    };
  }

  private extractPlayableUrl(url?: string): string {
    if (!url || !/^https?:\/\//i.test(url)) {
      return '';
    }
    return url;
  }

  private hasMediaCodec(codec?: string): boolean {
    if (!codec) {
      return false;
    }
    return codec.toLowerCase() !== 'none';
  }

  private shouldReplaceVideoCandidate(
    current: YtDlpFormat | undefined,
    incoming: YtDlpFormat,
  ): boolean {
    if (!current) {
      return true;
    }

    const currentIsMp4 = String(current.ext || '').toLowerCase() === 'mp4';
    const incomingIsMp4 = String(incoming.ext || '').toLowerCase() === 'mp4';
    if (incomingIsMp4 !== currentIsMp4) {
      return incomingIsMp4;
    }

    const currentBitrate = this.getYtDlpVideoBitrate(current);
    const incomingBitrate = this.getYtDlpVideoBitrate(incoming);
    if (incomingBitrate !== currentBitrate) {
      return incomingBitrate > currentBitrate;
    }

    const currentSize = this.getYtDlpFilesize(current);
    const incomingSize = this.getYtDlpFilesize(incoming);
    return incomingSize > currentSize;
  }

  private shouldReplaceAudioCandidate(
    current: YtDlpFormat | undefined,
    incoming: YtDlpFormat,
  ): boolean {
    if (!current) {
      return true;
    }

    const currentIsM4a = String(current.ext || '').toLowerCase() === 'm4a';
    const incomingIsM4a = String(incoming.ext || '').toLowerCase() === 'm4a';
    if (incomingIsM4a !== currentIsM4a) {
      return incomingIsM4a;
    }

    const currentBitrate = this.getYtDlpAudioBitrate(current);
    const incomingBitrate = this.getYtDlpAudioBitrate(incoming);
    if (incomingBitrate !== currentBitrate) {
      return incomingBitrate > currentBitrate;
    }

    const currentSize = this.getYtDlpFilesize(current);
    const incomingSize = this.getYtDlpFilesize(incoming);
    return incomingSize > currentSize;
  }

  private getYtDlpVideoBitrate(format: YtDlpFormat): number {
    return Number(format.tbr || format.vbr) || 0;
  }

  private getYtDlpAudioBitrate(format: YtDlpFormat): number {
    return Number(format.abr || format.tbr) || 0;
  }

  private getYtDlpFilesize(format: YtDlpFormat): number {
    return Number(format.filesize || format.filesize_approx) || 0;
  }

  private mapHeightToVideoQuality(height: number): VideoQualityLabel | null {
    if (!height || height < 360) {
      return null;
    }
    if (height >= 2160) {
      return '4k';
    }
    if (height >= 1080) {
      return '1080p';
    }
    if (height >= 720) {
      return '720p';
    }
    if (height >= 480) {
      return '480p';
    }
    return '360p';
  }

  private mapBitrateToAudioQuality(
    bitrate: number,
  ): AudioQualityLabel | null {
    if (!bitrate || bitrate <= 0) {
      return null;
    }
    if (bitrate >= 180) {
      return '192k';
    }
    if (bitrate >= 120) {
      return '132k';
    }
    return '64k';
  }

  private mapFormatMapToUrlMap<T extends string>(
    source: Map<T, YtDlpFormat>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [quality, format] of source.entries()) {
      const url = this.extractPlayableUrl(format.url);
      if (!url) {
        continue;
      }
      result[quality] = url;
    }
    return result;
  }

  private pickTopVideoUrl(qualityMap?: Record<string, string>): string {
    if (!qualityMap) {
      return '';
    }

    const order: VideoQualityLabel[] = ['4k', '1080p', '720p', '480p', '360p'];
    for (const quality of order) {
      if (qualityMap[quality]) {
        return qualityMap[quality];
      }
    }
    return '';
  }

  private pickTopAudioUrl(qualityMap?: Record<string, string>): string {
    if (!qualityMap) {
      return '';
    }

    const order: AudioQualityLabel[] = ['192k', '132k', '64k'];
    for (const quality of order) {
      if (qualityMap[quality]) {
        return qualityMap[quality];
      }
    }
    return '';
  }

  private pickBestAudioUrl(downloadOptions?: VideoDownloadOptions): string {
    return this.pickTopAudioUrl(downloadOptions?.audio);
  }

  private async isPlayableVideoUrl(url: string): Promise<boolean> {
    if (!url || this.isYoutubeWatchUrl(url)) {
      return false;
    }

    try {
      const response = await axios.get(url, {
        headers: {
          Range: 'bytes=0-1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://www.youtube.com/',
        },
        timeout: 12000,
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });

      return response.status === 200 || response.status === 206;
    } catch (_error) {
      return false;
    }
  }

  private isYoutubeWatchUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.includes('youtube.com') &&
        parsed.pathname.includes('/watch')
      );
    } catch (_error) {
      return false;
    }
  }

  private async getPlayableVideoUrlByYtDlp(pageUrl: string): Promise<string> {
    const ytDlpPath = this.resolveYtDlpPath();
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--format',
      '22/18/best[ext=mp4][acodec!=none]/best[acodec!=none]/best',
      '--get-url',
      pageUrl,
    ];

    try {
      const { stdout } = await execFileAsync(ytDlpPath, args, {
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      });
      return this.extractUrlFromYtDlpOutput(stdout);
    } catch (error: any) {
      this.logger.warn(`yt-dlp 获取直链失败: ${error?.message || 'unknown'}`);
      return '';
    }
  }

  private resolveYtDlpPath(): string {
    return resolveYtDlpPath(process.env.YTDLP_PATH?.trim());
  }

  private extractUrlFromYtDlpOutput(stdout: string): string {
    if (!stdout) {
      return '';
    }

    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const target = lines.find((line) => /^https?:\/\//i.test(line));
    return target || '';
  }

  /**
   * 格式化时长
   */
  private formatDuration(seconds: number): string {
    if (!seconds) return '00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}
