import { DouyinQualityService } from './douyin-quality.service';
import type { VideoInfo } from '../parsers/base.interface';

describe('DouyinQualityService', () => {
  let service: DouyinQualityService;
  const douyinAuthService = {
    getCookieHeader: jest.fn(),
  };

  const baseInfo: VideoInfo = {
    title: '测试抖音视频',
    cover: 'https://example.com/cover.jpg',
    duration: '00:10',
    platform: 'douyin',
    author: 'tester',
    description: 'desc',
    sourceUrl: 'https://www.douyin.com/video/7617779361726336307',
    videoUrl:
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=v0test123&ratio=720p&line=0',
    audioUrl: 'https://example.com/audio.m4a',
    downloadOptions: {
      merged: {
        '4k': 'https://example.com/video-4k.mp4',
        '1080p': 'https://example.com/video-1080.mp4',
        '720p': 'https://example.com/video-720.mp4',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DouyinQualityService(douyinAuthService as any);
  });

  it('returns complete immediately for multi-quality douyin parse results', async () => {
    douyinAuthService.getCookieHeader.mockResolvedValue(
      'sessionid=abc; ttwid=xyz;',
    );

    const result = await service.prepareParseResult(
      '7617779361726336307',
      baseInfo,
    );

    expect(result).toMatchObject({
      qualityStatus: 'complete',
    });
    expect(result.qualityRefreshKey).toBeTruthy();
    expect(result.downloadOptions?.merged).toEqual(
      expect.objectContaining({
        '4k': 'https://example.com/video-4k.mp4',
        '1080p': 'https://example.com/video-1080.mp4',
        '720p': 'https://example.com/video-720.mp4',
      }),
    );
  });

  it('marks single-quality official results as source_single_quality', async () => {
    douyinAuthService.getCookieHeader.mockResolvedValue(
      'sessionid=abc; ttwid=xyz;',
    );

    const result = await service.prepareParseResult(
      '7617779361726336307',
      {
        ...baseInfo,
        downloadOptions: {
          merged: {
            '720p': 'https://example.com/video-720.mp4',
          },
        },
      },
    );

    expect(result).toMatchObject({
      qualityStatus: 'source_single_quality',
    });
    expect(result.qualityMessage).toContain('单档');
  });

  it('reuses the richer cached official result for the same video and session', async () => {
    douyinAuthService.getCookieHeader.mockResolvedValue(
      'sessionid=abc; ttwid=xyz;',
    );

    const first = await service.prepareParseResult(
      '7617779361726336307',
      baseInfo,
    );

    const second = await service.prepareParseResult(
      '7617779361726336307',
      {
        ...baseInfo,
        downloadOptions: {
          merged: {
            '720p': 'https://example.com/video-720.mp4',
          },
        },
      },
    );

    expect(first.qualityStatus).toBe('complete');
    expect(second.qualityStatus).toBe('complete');
    expect(second.downloadOptions?.merged).toEqual(
      expect.objectContaining({
        '4k': 'https://example.com/video-4k.mp4',
        '1080p': 'https://example.com/video-1080.mp4',
        '720p': 'https://example.com/video-720.mp4',
      }),
    );
  });
});
