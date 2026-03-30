import { DouyinParser } from './douyin.parser';
import { ParserFailureError } from './parser-failure.error';
import type { VideoInfo } from './base.interface';

describe('DouyinParser', () => {
  let parser: DouyinParser;
  const originalEnv = process.env;
  const douyinAuthService = {
    getCookieHeader: jest.fn(),
  };
  const douyinOfficialDetailService = {
    fetchVideoInfo: jest.fn(),
  };
  const douyinOptimizationService = {
    buildMergedQualityMap: jest.fn(),
    runWarmTaskOnce: jest.fn(),
    getWarmTask: jest.fn(),
    upsertFact: jest.fn(),
  };
  const douyinQualityService = {
    prepareParseResult: jest.fn(),
  };

  const officialInfo: VideoInfo = {
    title: '官方详情',
    cover: 'https://example.com/cover.jpg',
    duration: '00:10',
    platform: 'douyin',
    author: 'tester',
    description: 'desc',
    sourceUrl: 'https://www.douyin.com/video/7616999831839558964',
    videoUrl:
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=v0test123&ratio=4k&line=0',
    audioUrl: 'https://example.com/audio.m4a',
    downloadOptions: {
      merged: {
        '4k':
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=v0test123&ratio=4k&line=0',
        '1080p':
          'https://aweme.snssdk.com/aweme/v1/play/?video_id=v0test123&ratio=1080p&line=0',
      },
    },
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    jest.clearAllMocks();
    douyinAuthService.getCookieHeader.mockResolvedValue(
      'sessionid=abc; ttwid=xyz;',
    );
    douyinOfficialDetailService.fetchVideoInfo.mockResolvedValue(officialInfo);
    douyinOptimizationService.buildMergedQualityMap.mockReturnValue({});
    douyinOptimizationService.runWarmTaskOnce.mockImplementation(
      async () => undefined,
    );
    douyinOptimizationService.getWarmTask.mockReturnValue(null);
    douyinQualityService.prepareParseResult.mockImplementation(
      async (_videoId: string, info: VideoInfo) => ({
        ...info,
        qualityStatus: 'complete',
        qualityRefreshKey: 'dyq:test',
      }),
    );
    parser = new DouyinParser(
      douyinAuthService as any,
      douyinOfficialDetailService as any,
      douyinOptimizationService as any,
      douyinQualityService as any,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('extracts aweme id from iesdouyin share path', () => {
    const videoId = (parser as any).extractVideoId(
      'https://www.iesdouyin.com/share/video/7616999831839558964/?region=CN',
    );

    expect(videoId).toBe('7616999831839558964');
  });

  it('fails fast for non-video douyin note share links', async () => {
    jest
      .spyOn(parser as any, 'resolveShareUrl')
      .mockResolvedValue(
        'https://www.iesdouyin.com/share/note/7614353472457590874/?region=CN',
      );

    await expect(
      parser.parse('https://v.douyin.com/ZH2A9SerD6c/'),
    ).rejects.toMatchObject({
      code: 'DOUYIN_NOTE_UNSUPPORTED',
      category: 'invalid_input',
      retryable: false,
      platform: 'douyin',
    });

    expect(douyinOfficialDetailService.fetchVideoInfo).not.toHaveBeenCalled();
  });

  it('fails with DOUYIN_SESSION_REQUIRED when no douyin session is available', async () => {
    douyinAuthService.getCookieHeader.mockResolvedValue('');

    await expect(
      parser.parse('https://www.douyin.com/video/7616999831839558964'),
    ).rejects.toMatchObject({
      code: 'DOUYIN_SESSION_REQUIRED',
      category: 'parse_failed',
      retryable: false,
      platform: 'douyin',
    });

    expect(douyinOfficialDetailService.fetchVideoInfo).not.toHaveBeenCalled();
  });

  it('parses douyin videos from the official signed detail endpoint only', async () => {
    const result = await parser.parse(
      'https://www.douyin.com/video/7616999831839558964',
    );

    expect(douyinOfficialDetailService.fetchVideoInfo).toHaveBeenCalledWith(
      '7616999831839558964',
      'sessionid=abc; ttwid=xyz;',
    );
    expect(result).toMatchObject({
      title: '官方详情',
      qualityStatus: 'complete',
      qualityRefreshKey: 'dyq:test',
    });
    expect(result.downloadOptions?.merged).toEqual(
      expect.objectContaining({
        '4k': expect.any(String),
        '1080p': expect.any(String),
      }),
    );
  });

  it('retries retryable official-detail failures and succeeds on the next attempt', async () => {
    const transientError = new ParserFailureError({
      code: 'DOUYIN_UPSTREAM_UNSTABLE',
      message: 'temporary upstream failure',
      category: 'upstream',
      retryable: true,
      platform: 'douyin',
    });

    const officialSpy = jest
      .spyOn(parser as any, 'getVideoInfoFromOfficial')
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(officialInfo);
    jest.spyOn(parser as any, 'sleep').mockResolvedValue(undefined);

    const result = await parser.parse(
      'https://www.douyin.com/video/7616999831839558964',
    );

    expect(result.title).toBe('官方详情');
    expect(officialSpy).toHaveBeenCalledTimes(2);
  });
});
