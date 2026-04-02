import { DownloadService } from './download.service';
import { DouyinProbeMode, VideoFormat, VideoQuality } from './dto/download.dto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { DouyinOptimizationService } from '../douyin-optimization/douyin-optimization.service';

describe('DownloadService getDownloadUrl', () => {
  let service: DownloadService;
  const originalEnv = process.env;
  const parsersService = {
    awaitDouyinQualityStatus: jest.fn(),
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    parsersService.awaitDouyinQualityStatus.mockReset();
    service = new DownloadService(
      {} as any,
      {} as any,
      parsersService as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const baseVideoInfo = {
    title: '测试视频',
    cover: 'https://example.com/cover.jpg',
    duration: '00:30',
    platform: 'bilibili' as const,
    videoUrl: 'https://example.com/default.mp4',
  };

  it('waits for enriched douyin quality info before selecting download stream', async () => {
    parsersService.awaitDouyinQualityStatus.mockResolvedValue({
      title: '抖音 4K',
      cover: 'https://example.com/cover.jpg',
      duration: '00:30',
      platform: 'douyin',
      videoUrl: 'https://example.com/default.mp4',
      qualityStatus: 'complete',
      qualityRefreshKey: 'dyq:test',
      downloadOptions: {
        merged: {
          '4k': 'https://example.com/douyin-4k.mp4',
          '1080p': 'https://example.com/douyin-1080.mp4',
        },
      },
    });
    jest
      .spyOn(service as any, 'resolveDouyinDirectStreamWithoutWatermarkFallback')
      .mockResolvedValue({
        stream: {
          url: 'https://example.com/douyin-4k.mp4',
          quality: '4k',
        },
      });

    const result = await service.getDownloadUrl(
      JSON.stringify({
        title: '抖音临时结果',
        cover: 'https://example.com/cover.jpg',
        duration: '00:30',
        platform: 'douyin',
        videoUrl: 'https://example.com/default.mp4',
        qualityStatus: 'enriching',
        qualityRefreshKey: 'dyq:test',
        downloadOptions: {
          merged: {
            '720p': 'https://example.com/douyin-720.mp4',
          },
        },
      }),
      VideoFormat.MP4,
      '4k' as any,
      false,
      true,
      DouyinProbeMode.FAST,
    );

    expect(parsersService.awaitDouyinQualityStatus).toHaveBeenCalledWith(
      'dyq:test',
      expect.any(Number),
    );
    expect(result.downloadUrl).toBe('https://example.com/douyin-4k.mp4');
    expect(result.quality).toBe('4k');
  });

  it('uses complete official douyin quality maps directly without waiting for enriching state', async () => {
    jest
      .spyOn(service as any, 'resolveDouyinDirectStreamWithoutWatermarkFallback')
      .mockResolvedValue({
        stream: {
          url: 'https://example.com/douyin-4k.mp4',
          quality: '4k',
        },
      });

    const result = await service.getDownloadUrl(
      JSON.stringify({
        title: '抖音官方结果',
        cover: 'https://example.com/cover.jpg',
        duration: '00:30',
        platform: 'douyin',
        videoUrl: 'https://example.com/default.mp4',
        qualityStatus: 'complete',
        qualityRefreshKey: 'dyq:test',
        downloadOptions: {
          merged: {
            '4k': 'https://example.com/douyin-4k.mp4',
            '1080p': 'https://example.com/douyin-1080.mp4',
          },
        },
      }),
      VideoFormat.MP4,
      '4k' as any,
      false,
      true,
      DouyinProbeMode.FAST,
    );

    expect(parsersService.awaitDouyinQualityStatus).not.toHaveBeenCalled();
    expect(result.downloadUrl).toBe('https://example.com/douyin-4k.mp4');
    expect(result.quality).toBe('4k');
  });

  it('probes the official douyin quality url directly instead of generating extra line candidates', async () => {
    const lineSpy = jest.spyOn(service as any, 'buildDouyinLineCandidates');
    const probeSpy = jest
      .spyOn(service as any, 'probeDouyinStreamResolution')
      .mockResolvedValue({
        status: 'ok',
        width: 2160,
        height: 3840,
        quality: '4k',
        finalUrl: 'https://example.com/video-4k.mp4',
        actualUrl: 'https://example.com/video-4k.mp4',
      });

    const result = await (service as any).resolveDouyinVerifiedStream(
      {
        '4k': 'https://aweme.snssdk.com/aweme/v1/play/?video_id=test&ratio=4k&line=0',
      },
      '4k',
      false,
      3000,
    );

    expect(probeSpy).toHaveBeenCalledWith(
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=test&ratio=4k&line=0',
      false,
    );
    expect(lineSpy).not.toHaveBeenCalled();
    expect(result.stream).toMatchObject({
      url: 'https://example.com/video-4k.mp4',
      quality: '4k',
    });
  });

  it('maps 1440 short-edge streams to 1440p instead of downgrading them to 1080p', () => {
    expect((service as any).mapResolutionToQuality(1440, 2560)).toBe('1440p');
    expect((service as any).mapResolutionToQuality(2560, 1440)).toBe('1440p');
  });

  it('prefers an exact 1440p line over a higher 4k line for a 1440p request', async () => {
    jest
      .spyOn(service as any, 'probeDouyinStreamResolution')
      .mockImplementation(async (url: string) => {
        if (url.includes('line=4')) {
          return {
            status: 'ok',
            width: 2160,
            height: 3840,
            quality: '4k',
            finalUrl: url,
            actualUrl: 'https://example.com/video-4k.mp4',
          };
        }

        if (url.includes('line=0')) {
          return {
            status: 'ok',
            width: 1440,
            height: 2560,
            quality: '1440p',
            finalUrl: url,
            actualUrl: 'https://example.com/video-1440.mp4',
          };
        }

        return {
          status: 'miss',
        };
      });

    const result = await (service as any).probeDouyinLineCandidates(
      [
        'https://www.douyin.com/aweme/v1/play/?video_id=test&line=4',
        'https://www.douyin.com/aweme/v1/play/?video_id=test&line=0',
      ],
      (service as any).getVideoQualityRank('1440p'),
      false,
      Date.now() + 3_000,
    );

    expect(result.bestProbe).toMatchObject({
      quality: '1440p',
      actualUrl: 'https://example.com/video-1440.mp4',
    });
  });

  it('does not upgrade a 720p request to cached 1080p when the provided douyin quality map only allows 720p', async () => {
    const douyinOptimizationService = new DouyinOptimizationService();
    service = new DownloadService(
      {} as any,
      {} as any,
      parsersService as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      douyinOptimizationService,
    );

    douyinOptimizationService.upsertFact({
      videoStreamId: 'test-stream',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '0',
      candidateUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=1080&sign=1080',
      finalUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=1080&sign=1080',
      actualUrl: 'https://cdn.example.com/video-1080.mp4',
      actualWidth: 1440,
      actualHeight: 1080,
      usedWatermarkFallback: false,
    });

    const result = await service.getDownloadUrl(
      JSON.stringify({
        title: '抖音 720',
        cover: 'https://example.com/cover.jpg',
        duration: '00:30',
        platform: 'douyin',
        videoUrl:
          'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=720&sign=720',
        qualityStatus: 'complete',
        qualityRefreshKey: 'dyq:test',
        downloadOptions: {
          merged: {
            '720p':
              'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=720&sign=720',
          },
        },
      }),
      VideoFormat.MP4,
      '720p' as any,
      false,
      false,
      DouyinProbeMode.FAST,
    );

    expect(result.quality).toBe('720p');
    expect(result.actualQuality).toBeUndefined();
    expect(result.downloadUrl).toContain('file_id%3D720');
  });

  it('does not let an exact 720p douyin candidate be promoted when a cached fact misreports it as 1080p', async () => {
    const douyinOptimizationService = new DouyinOptimizationService();
    service = new DownloadService(
      {} as any,
      {} as any,
      parsersService as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      douyinOptimizationService,
    );

    douyinOptimizationService.upsertFact({
      videoStreamId: 'test-stream',
      requestedQuality: '720p',
      actualQuality: '1080p',
      line: '0',
      candidateUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=720&sign=720',
      finalUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=720&sign=720',
      actualUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=1080&sign=1080',
      actualWidth: 1440,
      actualHeight: 1080,
      usedWatermarkFallback: false,
    });

    const result = await service.getDownloadUrl(
      JSON.stringify({
        title: '抖音 720',
        cover: 'https://example.com/cover.jpg',
        duration: '00:30',
        platform: 'douyin',
        videoUrl:
          'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=720&sign=720',
        qualityStatus: 'complete',
        qualityRefreshKey: 'dyq:test',
        downloadOptions: {
          merged: {
            '720p':
              'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=720&sign=720',
          },
        },
      }),
      VideoFormat.MP4,
      '720p' as any,
      false,
      false,
      DouyinProbeMode.FAST,
    );

    expect(result.quality).toBe('720p');
    expect(result.downloadUrl).toContain('file_id%3D720');
  });

  it('prefers douyin official videoCandidates over the flattened merged map when selecting exact quality', async () => {
    const result = await service.getDownloadUrl(
      JSON.stringify({
        title: '抖音官方候选',
        cover: 'https://example.com/cover.jpg',
        duration: '00:30',
        platform: 'douyin',
        videoUrl:
          'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=preview&sign=preview',
        qualityStatus: 'complete',
        qualityRefreshKey: 'dyq:test',
        downloadOptions: {
          merged: {
            '1080p':
              'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=merged1080&sign=merged1080',
          },
          videoCandidates: {
            '1080p': [
              {
                url:
                  'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=candidate1080&sign=candidate1080',
                width: 1080,
                height: 1920,
                bandwidth: 1103604,
                fileId: 'candidate1080',
                ratio: '1080p',
                sourceKind: 'bit_rate',
              },
            ],
          },
        },
      }),
      VideoFormat.MP4,
      VideoQuality.FHD,
      false,
      true,
      DouyinProbeMode.FAST,
    );

    expect(result.quality).toBe('1080p');
    expect(result.downloadUrl).toContain('file_id%3Dcandidate1080');
    expect(result.downloadUrl).not.toContain('file_id%3Dmerged1080');
  });

  it('does not reuse a cached douyin fact from another official candidate with the same requested quality', async () => {
    const douyinOptimizationService = new DouyinOptimizationService();
    service = new DownloadService(
      {} as any,
      {} as any,
      parsersService as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      douyinOptimizationService,
    );

    douyinOptimizationService.upsertFact({
      videoStreamId: 'test-stream',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '0',
      candidateUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=alternate1080&sign=alternate1080',
      finalUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=alternate1080&sign=alternate1080',
      actualUrl: 'https://cdn.example.com/video-alternate-1080.mp4',
      actualWidth: 1080,
      actualHeight: 1920,
      usedWatermarkFallback: false,
    });

    const result = await service.getDownloadUrl(
      JSON.stringify({
        title: '抖音官方候选',
        cover: 'https://example.com/cover.jpg',
        duration: '00:30',
        platform: 'douyin',
        videoUrl:
          'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=preview&sign=preview',
        qualityStatus: 'complete',
        qualityRefreshKey: 'dyq:test',
        downloadOptions: {
          merged: {
            '1080p':
              'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=primary1080&sign=primary1080',
          },
          videoCandidates: {
            '1080p': [
              {
                url:
                  'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=primary1080&sign=primary1080',
                width: 1080,
                height: 1920,
                bandwidth: 1103604,
                fileId: 'primary1080',
                ratio: '1080p',
                sourceKind: 'bit_rate',
              },
            ],
          },
        },
      }),
      VideoFormat.MP4,
      VideoQuality.FHD,
      false,
      true,
      DouyinProbeMode.FAST,
    );

    expect(result.quality).toBe('1080p');
    expect(result.downloadUrl).toContain('file_id%3Dprimary1080');
    expect(result.downloadUrl).not.toContain('video-alternate-1080.mp4');
  });

  it('should select merged stream by requested quality for mp4 download', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          merged: {
            '720p': 'https://example.com/merged-720.mp4',
            '1080p': 'https://example.com/merged-1080.mp4',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
    );

    expect(result.downloadUrl).toBe('https://example.com/merged-1080.mp4');
    expect((result as any).fileExtension).toBe('mp4');
  });

  it('should fallback to nearest lower quality when exact quality is unavailable', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          merged: {
            '720p': 'https://example.com/merged-720.mp4',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
    );

    expect(result.downloadUrl).toBe('https://example.com/merged-720.mp4');
    expect(result.quality).toBe('720p');
  });

  it('should keep 480p selection instead of incorrectly upgrading to HD', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          merged: {
            '480p': 'https://example.com/merged-480.mp4',
            '1080p': 'https://example.com/merged-1080.mp4',
          },
        },
      } as any,
      VideoFormat.MP4,
      '480p' as any,
    );

    expect(result.downloadUrl).toBe('https://example.com/merged-480.mp4');
    expect(result.quality).toBe('480p');
  });

  it('should fallback 720p request to 480p before upgrading to 1080p', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          merged: {
            '480p': 'https://example.com/merged-480.mp4',
            '1080p': 'https://example.com/merged-1080.mp4',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.HD,
    );

    expect(result.downloadUrl).toBe('https://example.com/merged-480.mp4');
    expect(result.quality).toBe('480p');
  });

  it('should keep exact 540p selection when that stream exists', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          merged: {
            '540p': 'https://example.com/merged-540.mp4',
            '720p': 'https://example.com/merged-720.mp4',
            '1080p': 'https://example.com/merged-1080.mp4',
          },
        },
      } as any,
      VideoFormat.MP4,
      '540p' as any,
    );

    expect(result.downloadUrl).toBe('https://example.com/merged-540.mp4');
    expect(result.quality).toBe('540p');
  });

  it('should return audio stream for audio format instead of default video url', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        audioUrl: 'https://example.com/audio-default.m4a',
        downloadOptions: {
          audio: {
            '720p': 'https://example.com/audio-720.m4a',
          },
        },
      } as any,
      VideoFormat.AUDIO,
      VideoQuality.HD,
    );

    expect(result.downloadUrl).toBe('https://example.com/audio-720.m4a');
    expect((result as any).fileExtension).toBe('m4a');
    expect(result.format).toBe(VideoFormat.AUDIO);
    expect(result.quality).toBe('720p');
  });

  it('should select nearest available audio bitrate and return actual audio quality', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        audioUrl: 'https://example.com/audio-default.m4a',
        downloadOptions: {
          audio: {
            '64k': 'https://example.com/audio-64.m4a',
            '192k': 'https://example.com/audio-192.m4a',
          },
        },
      } as any,
      VideoFormat.AUDIO,
      '160k' as any,
    );

    expect(result.downloadUrl).toBe('https://example.com/audio-192.m4a');
    expect(result.quality).toBe('192k');
  });

  it('should reject audio format when platform does not provide independent audio stream', async () => {
    await expect(
      service.getDownloadUrl(
        {
          ...baseVideoInfo,
          downloadOptions: {
            merged: {
              '1080p': 'https://example.com/video-1080.mp4',
            },
          },
        } as any,
        VideoFormat.AUDIO,
        '192k' as any,
      ),
    ).rejects.toThrow('当前平台未提供独立音频流');
  });

  it('should prefer backend merge endpoint for high-quality video-only streams', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          merged: {
            '720p': 'https://example.com/merged-720.mp4',
          },
          video: {
            '1080p': 'https://example.com/video-1080.m4s',
          },
          audio: {
            '192k': 'https://example.com/audio-192.m4s',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
    );

    expect(result.quality).toBe('1080p');
    expect(result.downloadUrl).toContain('/api/download/merge?');
    expect(result.downloadUrl).toContain('video=');
    expect(result.downloadUrl).toContain('audio=');
  });

  it('should use server merge for youtube when merged stream is lower than requested quality', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        platform: 'youtube' as const,
        downloadOptions: {
          merged: {
            '360p': 'https://example.com/yt-merged-360.mp4',
          },
          video: {
            '720p': 'https://example.com/yt-video-720.mp4',
          },
          audio: {
            '192k': 'https://example.com/yt-audio-192.m4a',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.HD,
    );

    expect(result.quality).toBe('720p');
    expect(result.downloadUrl).toContain('/api/download/merge?');
    expect(result.downloadUrl).toContain('yt-video-720.mp4');
    expect(result.downloadUrl).toContain('yt-audio-192.m4a');
  });

  it('should append iosCompatible=1 when iOS compatibility merge is forced', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          merged: {
            '720p': 'https://example.com/merged-720.mp4',
          },
          video: {
            '1080p': 'https://example.com/video-1080.mp4',
          },
          audio: {
            '192k': 'https://example.com/audio-192.m4a',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
      true,
    );

    expect(result.downloadUrl).toContain('/api/download/merge?');
    expect(result.downloadUrl).toContain('iosCompatible=1');
  });

  it('should keep default bilibili selection on non-iOS path when candidates exist', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          video: {
            '1080p': 'https://example.com/hevc-default.m4s',
          },
          videoCandidates: {
            '1080p': [
              {
                url: 'https://example.com/hevc-default.m4s',
                codecid: 12,
                width: 1920,
                height: 1080,
                frameRate: 60,
                bandwidth: 1900000,
              },
              {
                url: 'https://example.com/avc-ios.m4s',
                codecid: 7,
                width: 1920,
                height: 1080,
                frameRate: 30,
                bandwidth: 900000,
              },
            ],
          },
        },
      } as any,
      VideoFormat.WEBM,
      VideoQuality.FHD,
      false,
    );

    expect(result.downloadUrl).toBe('https://example.com/hevc-default.m4s');
  });

  it('should prefer AVC candidate for bilibili when iosCompatible is enabled', async () => {
    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        downloadOptions: {
          video: {
            '1080p': 'https://example.com/hevc-default.m4s',
          },
          videoCandidates: {
            '1080p': [
              {
                url: 'https://example.com/hevc-default.m4s',
                codecid: 12,
                width: 1920,
                height: 1080,
                frameRate: 60,
                bandwidth: 1900000,
              },
              {
                url: 'https://example.com/avc-ios.m4s',
                codecid: 7,
                width: 1920,
                height: 1080,
                frameRate: 30,
                bandwidth: 900000,
              },
            ],
          },
        },
      } as any,
      VideoFormat.WEBM,
      VideoQuality.FHD,
      true,
    );

    expect(result.downloadUrl).toBe('https://example.com/avc-ios.m4s');
  });

  it('should downgrade douyin 1080p request to measured quality and expose actual resolution', async () => {
    jest
      .spyOn(service as any, 'probeDouyinStreamResolution')
      .mockResolvedValue({
        status: 'ok',
        finalUrl:
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
        actualUrl:
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
        width: 720,
        height: 1280,
        quality: '720p',
        usedWatermarkFallback: false,
      });

    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        platform: 'douyin' as const,
        downloadOptions: {
          merged: {
            '1080p':
              'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
    );

    expect(result.quality).toBe('720p');
    expect((result as any).actualQuality).toBe('720p');
    expect((result as any).actualWidth).toBe(720);
    expect((result as any).actualHeight).toBe(1280);
  });

  it('should throw explicit watermark fallback required error for douyin when fallback is disabled', async () => {
    jest
      .spyOn(service as any, 'probeDouyinStreamResolution')
      .mockResolvedValue({
        status: 'watermark_fallback_required',
      });

    try {
      await service.getDownloadUrl(
        {
          ...baseVideoInfo,
          platform: 'douyin' as const,
          downloadOptions: {
            merged: {
              '1080p':
                'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
            },
          },
        } as any,
        VideoFormat.MP4,
        VideoQuality.FHD,
        false,
        false,
      );
      fail('expected getDownloadUrl to throw');
    } catch (error: any) {
      expect(error?.getResponse?.()).toEqual(
        expect.objectContaining({
          code: 'DOUYIN_WATERMARK_FALLBACK_REQUIRED',
        }),
      );
    }
  });

  it('should return proxy fetch url with allowWatermarkFallback=0 for douyin direct stream', async () => {
    jest
      .spyOn(service as any, 'probeDouyinStreamResolution')
      .mockResolvedValue({
        status: 'ok',
        finalUrl:
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
        actualUrl:
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
        width: 720,
        height: 1280,
        quality: '720p',
        usedWatermarkFallback: false,
      });

    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        platform: 'douyin' as const,
        downloadOptions: {
          merged: {
            '1080p':
              'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
      false,
      false,
    );

    expect(result.downloadUrl).toContain('/api/proxy/fetch?');
    expect(result.downloadUrl).toContain('allowWatermarkFallback=0');
  });

  it('should skip douyin strict probe in fast mode and return proxy url quickly', async () => {
    const probeSpy = jest.spyOn(service as any, 'probeDouyinStreamResolution');

    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        platform: 'douyin' as const,
        downloadOptions: {
          merged: {
            '1080p':
              'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
      false,
      true,
      'fast' as any,
    );

    expect(probeSpy).not.toHaveBeenCalled();
    expect(result.downloadUrl).toContain('/api/proxy/fetch?');
    expect(result.downloadUrl).toContain('allowWatermarkFallback=1');
  });

  it('should still preflight douyin fast mode when watermark fallback is disabled', async () => {
    const lineUrl =
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4';
    const resolveSpy = jest
      .spyOn(service as any, 'resolveDouyinVerifiedStream')
      .mockResolvedValue({
        stream: {
          url: lineUrl,
          quality: '1080p',
        },
        actualQuality: '1080p',
        actualWidth: 1080,
        actualHeight: 1920,
        usedWatermarkFallback: false,
      });

    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        platform: 'douyin' as const,
        downloadOptions: {
          merged: {
            '1080p': lineUrl,
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
      false,
      false,
      'fast' as any,
    );

    expect(resolveSpy).toHaveBeenCalledWith(
      {
        '1080p': lineUrl,
      },
      VideoQuality.FHD,
      false,
      expect.any(Number),
    );
    expect(result.downloadUrl).toContain('/api/proxy/fetch?');
    expect(result.downloadUrl).toContain('allowWatermarkFallback=0');
    expect(result.quality).toBe('1080p');
  });

  it('should throw watermark fallback required in douyin fast mode when no watermark-free stream exists', async () => {
    jest
      .spyOn(service as any, 'resolveDouyinVerifiedStream')
      .mockResolvedValue({
        stream: null,
        watermarkFallbackRequired: true,
      });

    await expect(
      service.getDownloadUrl(
        {
          ...baseVideoInfo,
          platform: 'douyin' as const,
          downloadOptions: {
            merged: {
              '1080p':
                'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
            },
          },
        } as any,
        VideoFormat.MP4,
        VideoQuality.FHD,
        false,
        false,
        'fast' as any,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DOUYIN_WATERMARK_FALLBACK_REQUIRED',
      }),
    });
  });

  it('should keep strict probe enabled when probe mode is strict', async () => {
    const probeSpy = jest
      .spyOn(service as any, 'probeDouyinStreamResolution')
      .mockResolvedValue({
        status: 'ok',
        finalUrl:
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
        actualUrl:
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
        width: 1080,
        height: 1920,
        quality: '1080p',
        usedWatermarkFallback: false,
      });

    const result = await service.getDownloadUrl(
      {
        ...baseVideoInfo,
        platform: 'douyin' as const,
        downloadOptions: {
          merged: {
            '1080p':
              'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
          },
        },
      } as any,
      VideoFormat.MP4,
      VideoQuality.FHD,
      false,
      true,
      'strict' as any,
    );

    expect(probeSpy).toHaveBeenCalled();
    expect(result.quality).toBe('1080p');
  });

  it('should use smart probe budget and schedule strict warmup when quick probe misses', async () => {
    const lineUrl =
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4';
    const resolveSpy = jest
      .spyOn(service as any, 'resolveDouyinVerifiedStream')
      .mockResolvedValue({
        stream: null,
      });
    const warmSpy = jest
      .spyOn(service as any, 'scheduleDouyinStrictWarmProbe')
      .mockImplementation(() => undefined);

    const resolved = await (service as any).resolveDouyinStreamForMode(
      { '1080p': lineUrl },
      '1080p',
      true,
      DouyinProbeMode.SMART,
    );

    expect(resolved.stream).toBeNull();
    expect(resolveSpy).toHaveBeenCalledWith(
      { '1080p': lineUrl },
      '1080p',
      true,
      (service as any).douyinSmartProbeBudgetMs,
    );
    expect(warmSpy).toHaveBeenCalledWith(
      { '1080p': lineUrl },
      '1080p',
      true,
    );
  });

  it('should not schedule strict warmup when smart probe already resolves a stream', async () => {
    const lineUrl =
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4';
    jest
      .spyOn(service as any, 'resolveDouyinVerifiedStream')
      .mockResolvedValue({
        stream: {
          url: lineUrl,
          quality: '1080p',
        },
      });
    const warmSpy = jest
      .spyOn(service as any, 'scheduleDouyinStrictWarmProbe')
      .mockImplementation(() => undefined);

    const resolved = await (service as any).resolveDouyinStreamForMode(
      { '1080p': lineUrl },
      '1080p',
      true,
      DouyinProbeMode.SMART,
    );

    expect(resolved.stream?.url).toBe(lineUrl);
    expect(warmSpy).not.toHaveBeenCalled();
  });

  it('should use clean cached douyin optimization fact in strict mode without probing', async () => {
    const optimizationService = new DouyinOptimizationService();
    optimizationService.upsertFact({
      videoStreamId: 'test123',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '4',
      candidateUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
      finalUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
      actualUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
      actualWidth: 1080,
      actualHeight: 1920,
      usedWatermarkFallback: false,
    });
    const cachedService = new DownloadService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      optimizationService as any,
    );
    const probeSpy = jest.spyOn(cachedService as any, 'resolveDouyinVerifiedStream');

    const resolved = await (cachedService as any).resolveDouyinStreamForMode(
      {
        '1080p':
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=0',
      },
      '1080p',
      false,
      DouyinProbeMode.STRICT,
    );

    expect(resolved.stream?.url).toContain('line=4');
    expect(resolved.actualQuality).toBe('1080p');
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it('should ignore watermark-only cached douyin fact in strict mode and continue probing', async () => {
    const optimizationService = new DouyinOptimizationService();
    optimizationService.upsertFact({
      videoStreamId: 'test123',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '4',
      candidateUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
      finalUrl:
        'https://aweme.snssdk.com/aweme/v1/playwm/?video_id=test123&ratio=1080p&line=4',
      actualUrl:
        'https://aweme.snssdk.com/aweme/v1/playwm/?video_id=test123&ratio=1080p&line=4',
      actualWidth: 1080,
      actualHeight: 1920,
      usedWatermarkFallback: true,
    });
    const cachedService = new DownloadService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      optimizationService as any,
    );
    const probeSpy = jest
      .spyOn(cachedService as any, 'resolveDouyinVerifiedStream')
      .mockResolvedValue({
        stream: {
          url: 'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=3',
          quality: '1080p',
        },
        actualQuality: '1080p',
        actualWidth: 1080,
        actualHeight: 1920,
      });

    const resolved = await (cachedService as any).resolveDouyinStreamForMode(
      {
        '1080p':
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=0',
      },
      '1080p',
      false,
      DouyinProbeMode.STRICT,
    );

    expect(resolved.stream?.url).toContain('line=3');
    expect(probeSpy).toHaveBeenCalled();
  });

  it('should use cached douyin optimization fact in fast mode without strict probing', async () => {
    const optimizationService = new DouyinOptimizationService();
    optimizationService.upsertFact({
      videoStreamId: 'test123',
      requestedQuality: '1080p',
      actualQuality: '720p',
      line: '4',
      candidateUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
      finalUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
      actualUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
      actualWidth: 720,
      actualHeight: 1280,
      usedWatermarkFallback: false,
    });
    const cachedService = new DownloadService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      optimizationService as any,
    );
    const probeSpy = jest.spyOn(cachedService as any, 'resolveDouyinVerifiedStream');

    const resolved = await (cachedService as any).resolveDouyinStreamForMode(
      {
        '1080p':
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=0',
      },
      '1080p',
      true,
      DouyinProbeMode.FAST,
    );

    expect(resolved.stream?.url).toContain('line=4');
    expect(resolved.actualQuality).toBe('720p');
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it('should use cached douyin optimization fact in smart mode before quick probe', async () => {
    const optimizationService = new DouyinOptimizationService();
    optimizationService.upsertFact({
      videoStreamId: 'test123',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '3',
      candidateUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=3',
      finalUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=3',
      actualUrl:
        'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=3',
      actualWidth: 1080,
      actualHeight: 1920,
      usedWatermarkFallback: false,
    });
    const cachedService = new DownloadService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      optimizationService as any,
    );
    const probeSpy = jest.spyOn(cachedService as any, 'resolveDouyinVerifiedStream');

    const resolved = await (cachedService as any).resolveDouyinStreamForMode(
      {
        '1080p':
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=0',
      },
      '1080p',
      true,
      DouyinProbeMode.SMART,
    );

    expect(resolved.stream?.url).toContain('line=3');
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it('should stop probing extra douyin line candidates once requested quality is satisfied', async () => {
    const lineUrl =
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4';
    jest
      .spyOn(service as any, 'buildDouyinLineCandidates')
      .mockReturnValue([
        lineUrl,
        lineUrl.replace('line=4', 'line=3'),
        lineUrl.replace('line=4', 'line=2'),
      ]);
    const probeSpy = jest
      .spyOn(service as any, 'probeDouyinStreamResolution')
      .mockResolvedValue({
        status: 'ok',
        finalUrl: lineUrl,
        actualUrl: lineUrl,
        width: 1080,
        height: 1920,
        quality: '1080p',
        usedWatermarkFallback: false,
      });

    const resolved = await (service as any).resolveDouyinVerifiedStream(
      { '1080p': lineUrl },
      '1080p',
      true,
    );

    expect(resolved.stream?.quality).toBe('1080p');
    expect(probeSpy.mock.calls.length).toBeGreaterThan(0);
    expect(probeSpy.mock.calls.length).toBeLessThan(3);
  });

  it('should deduplicate concurrent douyin probe requests with same cache key', async () => {
    const rawSpy = jest
      .spyOn(service as any, 'probeDouyinStreamResolutionRaw')
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return {
          status: 'ok',
          finalUrl:
            'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
          actualUrl:
            'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4',
          width: 1080,
          height: 1920,
          quality: '1080p',
          usedWatermarkFallback: false,
        };
      });

    const targetUrl =
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4';
    const [first, second] = await Promise.all([
      (service as any).probeDouyinStreamResolution(targetUrl, true),
      (service as any).probeDouyinStreamResolution(targetUrl, true),
    ]);

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(rawSpy).toHaveBeenCalledTimes(1);
  });

  it('should build default and iOS-compatible merge codecs separately', () => {
    const defaultArgs = (service as any).buildStandardStreamMergeOutputArgs(
      'https://example.com/audio-192.m4a',
    );
    expect(defaultArgs).toEqual(
      expect.arrayContaining(['-c:v', 'copy', '-movflags', 'frag_keyframe+empty_moov']),
    );

    const iosArgs = (service as any).buildIosCompatibleMergeOutputArgs('/tmp/output.mp4');
    expect(iosArgs).toEqual(
      expect.arrayContaining([
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-tag:v',
        'avc1',
        '-c:a',
        'aac',
      ]),
    );
  });

  describe('youtube async download helpers', () => {
    it('uses 4 as default yt-dlp concurrent fragments', () => {
      expect((service as any).ytDlpConcurrentFragments).toBe(4);
    });

    it('reads yt-dlp concurrent fragments from environment', () => {
      process.env.YTDLP_CONCURRENT_FRAGMENTS = '2';
      const customService = new DownloadService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      expect((customService as any).ytDlpConcurrentFragments).toBe(2);
    });

    it('should cap 1080p selector by long-edge threshold for portrait compatibility', () => {
      const selector = (service as any).buildYoutubeFormatSelector('1080p');
      expect(selector).toContain('height<=1920');
      expect(selector).toContain('width<=1920');
    });

    it('should require minimum 2160p stream when selecting 4k', () => {
      const selector = (service as any).buildYoutubeFormatSelector('4k');
      expect(selector).toContain('height>=2160');
    });

    it('should avoid unconstrained best fallback for 4k async selector', () => {
      const selector = (service as any).buildYoutubeFormatSelector('4k');
      expect(selector).not.toMatch(/\/best(?:$|\/)/);
    });

    it('should avoid unconstrained best fallback for 1080p async selector', () => {
      const selector = (service as any).buildYoutubeFormatSelector('1080p');
      expect(selector).not.toMatch(/\/best(?:$|\/)/);
    });

    it('should split progress lines by carriage return and newline', () => {
      const lines = (service as any).splitProcessOutputLines(
        'line1\rline2\nline3\r\nline4',
      );
      expect(lines).toEqual(['line1', 'line2', 'line3', 'line4']);
    });

    it('should extract first http url from share text', () => {
      const url = (service as any).extractFirstHttpUrl(
        '9.71 07/17 xxx https://v.douyin.com/u075MtsHxus/ 复制打开',
      );
      expect(url).toBe('https://v.douyin.com/u075MtsHxus/');
    });

    it('should trim wrapping punctuation around url', () => {
      const url = (service as any).extractFirstHttpUrl(
        '“https://www.youtube.com/watch?v=xGHI8GYy1V0”',
      );
      expect(url).toBe('https://www.youtube.com/watch?v=xGHI8GYy1V0');
    });
  });

  it('should set Content-Length when streaming completed task file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'download-task-'));
    const filePath = join(tempDir, 'output.mp4');
    const content = '1234567890';
    try {
      writeFileSync(filePath, content);

      const findOne = jest.fn().mockResolvedValue({
        id: 'task-1',
        userId: 'user-1',
        status: 'completed',
        outputPath: filePath,
        fileExtension: 'mp4',
        title: '测试视频',
      });
      (service as any).downloadTaskRepository = { findOne };

      const response = new PassThrough();
      const setHeader = jest.fn();
      (response as any).setHeader = setHeader;

      await service.streamTaskFile('user-1', 'task-1', response as any);

      expect(findOne).toHaveBeenCalledWith({
        where: { id: 'task-1', userId: 'user-1' },
      });
      expect(setHeader).toHaveBeenCalledWith('Content-Length', Buffer.byteLength(content));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns friendly error when task file is already expired', async () => {
    const findOne = jest.fn().mockResolvedValue({
      id: 'task-expired',
      userId: 'user-1',
      status: 'expired',
      outputPath: null,
      fileExtension: null,
      title: '过期任务',
    });
    (service as any).downloadTaskRepository = { findOne };

    await expect(
      service.streamTaskFile('user-1', 'task-expired', new PassThrough() as any),
    ).rejects.toThrow('任务文件已过期，请重新创建下载任务');
  });

  it('cleans up expired completed task files and marks task as expired', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'download-cleanup-'));
    const taskId = 'task-cleanup-1';
    const taskDir = join(tempRoot, taskId);
    const outputPath = join(taskDir, 'output.mp4');

    mkdirSync(taskDir, { recursive: true });
    writeFileSync(outputPath, 'cleanup-test-content');

    (service as any).tasksDir = tempRoot;

    const find = jest.fn().mockResolvedValue([
      {
        id: taskId,
        status: 'completed',
        outputPath,
        updatedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      },
    ]);
    const update = jest.fn().mockResolvedValue(undefined);
    (service as any).downloadTaskRepository = { find, update };

    try {
      await (service as any).cleanupExpiredTaskFiles(
        new Date(Date.now() - 6 * 60 * 60 * 1000),
      );

      expect(existsSync(outputPath)).toBe(false);
      expect(update).toHaveBeenCalledWith(
        { id: taskId },
        expect.objectContaining({
          status: 'expired',
          outputPath: null,
          downloadUrl: null,
          fileExtension: null,
        }),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not update tasks when cleanup query returns empty result', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const update = jest.fn().mockResolvedValue(undefined);
    (service as any).downloadTaskRepository = { find, update };

    await (service as any).cleanupExpiredTaskFiles(new Date(Date.now() - 1000));

    expect(update).not.toHaveBeenCalled();
  });

  it('returns task progress with null downloadUrl when task is expired', async () => {
    const findOne = jest.fn().mockResolvedValue({
      id: 'task-expired-progress',
      userId: 'user-1',
      status: 'expired',
      progress: 0,
      message: '文件已过期，请重新创建下载任务',
      title: '过期任务',
      format: 'mp4',
      quality: '1080p',
      fileExtension: null,
      downloadUrl: null,
      createdAt: new Date('2026-03-17T00:00:00.000Z'),
      updatedAt: new Date('2026-03-17T00:10:00.000Z'),
    });
    (service as any).downloadTaskRepository = { findOne };

    const snapshot = await service.getTaskProgress('user-1', 'task-expired-progress');

    expect(snapshot?.status).toBe('expired');
    expect(snapshot?.downloadUrl).toBeNull();
  });
});

describe('DownloadService prepareNativeSilentDownload', () => {
  let service: DownloadService;
  const parsersService = {} as any;
  const downloadModeService = {
    resolveGetUrlPolicy: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DownloadService(
      {} as any,
      {} as any,
      parsersService,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      downloadModeService as any,
    );
  });

  it('returns a direct native silent download payload for non-youtube sources', async () => {
    jest.spyOn(service, 'parseVideo').mockResolvedValue({
      title: 'Bili Test',
      platform: 'bilibili',
      sourceUrl: 'https://www.bilibili.com/video/BV1test',
      videoUrl: 'https://cdn.example.com/default.mp4',
      downloadOptions: {
        video: {
          '1080p': 'https://cdn.example.com/video-1080.mp4',
        },
      },
    } as any);
    jest.spyOn(service, 'checkDownloadPermission').mockResolvedValue({
      allowed: true,
    } as any);
    jest.spyOn(service, 'getDownloadUrl').mockResolvedValue({
      downloadUrl: 'https://cdn.example.com/video-1080.mp4',
      format: VideoFormat.MP4,
      quality: '1080p',
      fileExtension: 'mp4',
    } as any);
    jest.spyOn(service, 'recordDownload').mockResolvedValue({ id: 'history-1' } as any);
    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      iosCompatible: false,
      allowWatermarkFallback: false,
      probeMode: DouyinProbeMode.STRICT,
    });

    const result = await service.prepareNativeSilentDownload({
      userId: 'user-1',
      sourceUrl: ' https://www.bilibili.com/video/BV1test ',
      clientType: 'MOBILE' as any,
      runtimeTraceId: 'trace-1',
    });

    expect(result).toEqual({
      mode: 'direct',
      downloadUrl: 'https://cdn.example.com/video-1080.mp4',
      fileExtension: 'mp4',
      fileName: 'Bili Test',
      quality: '1080p',
      platform: 'bilibili',
      iosCompatible: false,
      authPolicy: 'none',
      runtimeTraceId: 'trace-1',
    });
    expect(service.getDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://www.bilibili.com/video/BV1test',
      }),
      VideoFormat.MP4,
      '1080p',
      false,
      false,
      DouyinProbeMode.STRICT,
      'trace-1',
    );
    expect(service.recordDownload).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        sourceUrl: 'https://www.bilibili.com/video/BV1test',
      }),
      VideoFormat.MP4,
      '1080p',
      'https://cdn.example.com/video-1080.mp4',
    );
  });

  it('returns a background task payload for high-quality youtube native silent downloads', async () => {
    jest.spyOn(service, 'parseVideo').mockResolvedValue({
      title: 'YouTube Test',
      platform: 'youtube',
      sourceUrl: 'https://youtube.com/watch?v=test',
      videoUrl: 'https://youtube.com/watch?v=test',
      downloadOptions: {
        video: {
          '1080p': 'https://youtube.example.com/video-1080.mp4',
        },
      },
    } as any);
    jest.spyOn(service, 'checkDownloadPermission').mockResolvedValue({
      allowed: true,
    } as any);
    const createDownloadTaskSpy = jest
      .spyOn(service, 'createDownloadTask')
      .mockResolvedValue({
        id: 'task-1',
        status: 'queued' as any,
        progress: 0,
      });

    const result = await service.prepareNativeSilentDownload({
      userId: 'user-1',
      sourceUrl: 'https://youtube.com/watch?v=test',
      clientType: 'MOBILE' as any,
      runtimeTraceId: 'trace-2',
    });

    expect(result).toEqual({
      mode: 'serverTask',
      taskId: 'task-1',
      pollIntervalMs: 1200,
      fileName: 'YouTube Test',
      quality: '1080p',
      platform: 'youtube',
      iosCompatible: false,
      authPolicy: 'bearer',
      runtimeTraceId: 'trace-2',
    });
    expect(createDownloadTaskSpy).toHaveBeenCalledWith(
      'user-1',
      'https://youtube.com/watch?v=test',
      expect.objectContaining({
        sourceUrl: 'https://youtube.com/watch?v=test',
      }),
      VideoFormat.MP4,
      '1080p',
      'trace-2',
    );
  });

  it('forces ios-compatible mode when explicitly requested for native silent prepare', async () => {
    jest.spyOn(service, 'parseVideo').mockResolvedValue({
      title: 'Bili Forced iOS',
      platform: 'bilibili',
      sourceUrl: 'https://www.bilibili.com/video/BV1forced',
      videoUrl: 'https://cdn.example.com/default.mp4',
      downloadOptions: {
        video: {
          '1080p': 'https://cdn.example.com/video-1080.mp4',
        },
        videoCandidates: {
          '1080p': [
            {
              url: 'https://cdn.example.com/video-1080.mp4',
              codecid: 7,
            },
          ],
        },
      },
    } as any);
    jest.spyOn(service, 'checkDownloadPermission').mockResolvedValue({
      allowed: true,
    } as any);
    jest.spyOn(service, 'getDownloadUrl').mockResolvedValue({
      downloadUrl: 'https://cdn.example.com/video-1080-ios.mp4',
      format: VideoFormat.MP4,
      quality: '1080p',
      fileExtension: 'mp4',
    } as any);
    jest.spyOn(service, 'recordDownload').mockResolvedValue({ id: 'history-2' } as any);
    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      iosCompatible: true,
      allowWatermarkFallback: false,
      probeMode: DouyinProbeMode.STRICT,
    });

    const result = await service.prepareNativeSilentDownload({
      userId: 'user-1',
      sourceUrl: 'https://www.bilibili.com/video/BV1forced',
      clientType: 'MOBILE' as any,
      iosCompatible: true,
      runtimeTraceId: 'trace-3',
    });

    expect(downloadModeService.resolveGetUrlPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: expect.objectContaining({
          iosCompatible: true,
        }),
      }),
    );
    expect(service.getDownloadUrl).toHaveBeenCalledWith(
      expect.anything(),
      VideoFormat.MP4,
      '1080p',
      true,
      false,
      DouyinProbeMode.STRICT,
      'trace-3',
    );
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'direct',
        iosCompatible: true,
      }),
    );
  });

  it('keeps heuristic ios-compatible first attempt when override is null', async () => {
    jest.spyOn(service, 'parseVideo').mockResolvedValue({
      title: 'Bili Hevc',
      platform: 'bilibili',
      sourceUrl: 'https://www.bilibili.com/video/BV1hevc',
      videoUrl: 'https://cdn.example.com/default.mp4',
      downloadOptions: {
        video: {
          '1080p': 'https://cdn.example.com/video-hevc.mp4',
        },
        videoCandidates: {
          '1080p': [
            {
              url: 'https://cdn.example.com/video-hevc.mp4',
              codecid: 12,
            },
            {
              url: 'https://cdn.example.com/video-avc.mp4',
              codecid: 7,
            },
          ],
        },
      },
    } as any);
    jest.spyOn(service, 'checkDownloadPermission').mockResolvedValue({
      allowed: true,
    } as any);
    jest.spyOn(service, 'getDownloadUrl').mockResolvedValue({
      downloadUrl: 'https://cdn.example.com/video-hevc-ios.mp4',
      format: VideoFormat.MP4,
      quality: '1080p',
      fileExtension: 'mp4',
    } as any);
    jest.spyOn(service, 'recordDownload').mockResolvedValue({ id: 'history-3' } as any);
    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      iosCompatible: true,
      allowWatermarkFallback: false,
      probeMode: DouyinProbeMode.STRICT,
    });

    const result = await service.prepareNativeSilentDownload({
      userId: 'user-1',
      sourceUrl: 'https://www.bilibili.com/video/BV1hevc',
      clientType: 'MOBILE' as any,
      iosCompatible: null,
      runtimeTraceId: 'trace-4',
    });

    expect(downloadModeService.resolveGetUrlPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: expect.objectContaining({
          iosCompatible: true,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'direct',
        iosCompatible: true,
      }),
    );
  });

  it('overrides the default ios-compatible heuristic when explicitly disabled', async () => {
    jest.spyOn(service, 'parseVideo').mockResolvedValue({
      title: 'Bili Forced Default',
      platform: 'bilibili',
      sourceUrl: 'https://www.bilibili.com/video/BV1noios',
      videoUrl: 'https://cdn.example.com/default.mp4',
      downloadOptions: {
        video: {
          '1080p': 'https://cdn.example.com/video-hevc.mp4',
        },
        videoCandidates: {
          '1080p': [
            {
              url: 'https://cdn.example.com/video-hevc.mp4',
              codecid: 12,
            },
            {
              url: 'https://cdn.example.com/video-avc.mp4',
              codecid: 7,
            },
          ],
        },
      },
    } as any);
    jest.spyOn(service, 'checkDownloadPermission').mockResolvedValue({
      allowed: true,
    } as any);
    jest.spyOn(service, 'getDownloadUrl').mockResolvedValue({
      downloadUrl: 'https://cdn.example.com/video-hevc.mp4',
      format: VideoFormat.MP4,
      quality: '1080p',
      fileExtension: 'mp4',
    } as any);
    jest.spyOn(service, 'recordDownload').mockResolvedValue({ id: 'history-4' } as any);
    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      iosCompatible: false,
      allowWatermarkFallback: false,
      probeMode: DouyinProbeMode.STRICT,
    });

    const result = await service.prepareNativeSilentDownload({
      userId: 'user-1',
      sourceUrl: 'https://www.bilibili.com/video/BV1noios',
      clientType: 'MOBILE' as any,
      iosCompatible: false,
      runtimeTraceId: 'trace-5',
    });

    expect(downloadModeService.resolveGetUrlPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: expect.objectContaining({
          iosCompatible: false,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'direct',
        iosCompatible: false,
      }),
    );
  });

  it('avoids the async youtube task path when ios-compatible mode is explicitly forced', async () => {
    jest.spyOn(service, 'parseVideo').mockResolvedValue({
      title: 'YouTube Forced Direct',
      platform: 'youtube',
      sourceUrl: 'https://youtube.com/watch?v=direct',
      videoUrl: 'https://youtube.com/watch?v=direct',
      downloadOptions: {
        video: {
          '1080p': 'https://youtube.example.com/video-1080.mp4',
        },
      },
    } as any);
    jest.spyOn(service, 'checkDownloadPermission').mockResolvedValue({
      allowed: true,
    } as any);
    const createDownloadTaskSpy = jest
      .spyOn(service, 'createDownloadTask')
      .mockResolvedValue({
        id: 'task-direct-should-not-happen',
        status: 'queued' as any,
        progress: 0,
      });
    jest.spyOn(service, 'getDownloadUrl').mockResolvedValue({
      downloadUrl: 'https://youtube.example.com/video-1080.mp4',
      format: VideoFormat.MP4,
      quality: '1080p',
      fileExtension: 'mp4',
    } as any);
    jest.spyOn(service, 'recordDownload').mockResolvedValue({ id: 'history-5' } as any);
    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      iosCompatible: true,
      allowWatermarkFallback: false,
      probeMode: DouyinProbeMode.STRICT,
    });

    const result = await service.prepareNativeSilentDownload({
      userId: 'user-1',
      sourceUrl: 'https://youtube.com/watch?v=direct',
      clientType: 'MOBILE' as any,
      iosCompatible: true,
      runtimeTraceId: 'trace-6',
    });

    expect(createDownloadTaskSpy).not.toHaveBeenCalled();
    expect(service.getDownloadUrl).toHaveBeenCalledWith(
      expect.anything(),
      VideoFormat.MP4,
      '1080p',
      true,
      false,
      DouyinProbeMode.STRICT,
      'trace-6',
    );
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'direct',
        iosCompatible: true,
      }),
    );
  });
});

describe('DownloadService checkDownloadPermission', () => {
  it('allows active users to download any platform and quality without membership gating', async () => {
    const usersService = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        accountStatus: 'ACTIVE',
      }),
    };
    const service = new DownloadService(
      {} as any,
      {} as any,
      {} as any,
      usersService as any,
      {} as any,
    );

    const result = await service.checkDownloadPermission({
      userId: 'user-1',
      platform: 'youtube',
      quality: VideoQuality.UHD,
    });

    expect(result).toEqual({ allowed: true });
  });
});
