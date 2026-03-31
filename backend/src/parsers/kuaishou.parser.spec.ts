import { KuaishouParser } from './kuaishou.parser';
import { ParserFailureError } from './parser-failure.error';

describe('KuaishouParser', () => {
  let parser: KuaishouParser;
  let kuaishouAuthService: {
    getCookieHeader: jest.Mock;
  };
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      KUAISHOU_PARSE_MIN_INTERVAL_MS: '1',
      KUAISHOU_PARSE_MAX_ATTEMPTS: '2',
      KUAISHOU_RISK_COOLDOWN_THRESHOLD: '1',
      KUAISHOU_RISK_COOLDOWN_MS: '3000',
      KUAISHOU_PARSE_RETRY_BASE_MS: '1',
      KUAISHOU_PARSE_RETRY_JITTER_MS: '1',
      KUAISHOU_QUALITY_PROBE_ENABLED: 'false',
    };
    jest.restoreAllMocks();
    kuaishouAuthService = {
      getCookieHeader: jest.fn().mockResolvedValue(
        [
          'did=web_123',
          'clientid=3',
          'kpf=PC_WEB',
          'kpn=KUAISHOU_VISION',
          'kuaishou.server.web_st=secure-token',
        ].join('; '),
      ),
    };
    parser = new (KuaishouParser as any)(kuaishouAuthService);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('supports kuaishou share urls', () => {
    expect(parser.supports('https://www.kuaishou.com/f/XaQsztzIbZEouNj')).toBe(true);
    expect(parser.supports('https://v.kuaishou.com/abcd')).toBe(true);
    expect(parser.supports('https://example.com/video/1')).toBe(false);
  });

  it('extracts photo id from resolved short-video url', () => {
    const photoId = (parser as any).extractPhotoId(
      'https://www.kuaishou.com/short-video/3xjg2gbd9snrsvy?shareToken=abc',
    );
    expect(photoId).toBe('3xjg2gbd9snrsvy');
  });

  it('extracts first http url from share text', () => {
    const extracted = (parser as any).extractFirstHttpUrl(
      'https://v.kuaishou.com/K4URZPj1 "瓜蛋摇 该作品在快手被播放过1.6万次，点击链接，打开【快手】直接观看！',
    );
    expect(extracted).toBe('https://v.kuaishou.com/K4URZPj1');
  });

  it('parses share text by normalizing to the first short url before resolving', async () => {
    jest.spyOn(parser as any, 'sleep').mockResolvedValue(undefined);
    const resolveShareUrlSpy = jest
      .spyOn(parser as any, 'resolveShareUrl')
      .mockResolvedValue(
        'https://www.kuaishou.com/short-video/photo_text_1?shareToken=abc',
      );
    expect(typeof (parser as any).fetchVisionVideoDetailViaGraphql).toBe('function');
    if (typeof (parser as any).fetchVisionVideoDetailViaGraphql !== 'function') {
      return;
    }
    jest
      .spyOn(parser as any, 'fetchVisionVideoDetailViaGraphql')
      .mockResolvedValue({
        status: 1,
        author: { name: '文本作者' },
        photo: {
          id: 'photo_text_1',
          caption: '文本分享测试',
          coverUrl: 'https://example.com/cover.jpg',
          duration: 12000,
          photoUrl: 'https://example.com/video.mp4',
          manifest: {
            adaptationSet: [
              {
                representation: [
                  {
                    url: 'https://example.com/video.mp4',
                    width: 720,
                    height: 1280,
                    qualityType: '720p',
                    qualityLabel: '高清',
                    avgBitrate: 1200,
                  },
                ],
              },
            ],
          },
        },
      });

    const result = await parser.parse(
      'https://v.kuaishou.com/K4URZPj1 "瓜蛋摇 该作品在快手被播放过1.6万次，点击链接，打开【快手】直接观看！',
    );

    expect(result.platform).toBe('kuaishou');
    expect(result.videoUrl).toBe('https://example.com/video.mp4');
    expect(resolveShareUrlSpy).toHaveBeenCalledWith('https://v.kuaishou.com/K4URZPj1');
    expect(kuaishouAuthService.getCookieHeader).toHaveBeenCalledTimes(1);
  });

  it('sanitizes title by removing kuaishou account id suffix in mention', async () => {
    const detail = {
      author: {
        name: '测试作者',
      },
      photo: {
        id: 'photo_title_1',
        caption: '#瓜蛋摇 @烦呐(O3xsr46sx4wwaps4)',
        coverUrl: 'https://example.com/cover.jpg',
        duration: 16000,
        photoUrl: 'https://example.com/video.mp4',
      },
    };

    const info = await (parser as any).buildVideoInfoFromVisionDetail(detail);
    expect(info.title).toBe('#瓜蛋摇 @烦呐');
    expect(info.description).toBe('#瓜蛋摇 @烦呐');
  });

  it('builds quality map from vision detail and keeps quality labels stable', async () => {
    const detail = {
      author: {
        name: '测试作者',
      },
      photo: {
        id: 'photo_1',
        caption: '测试视频',
        coverUrl: 'https://example.com/cover.jpg',
        duration: 30000,
        photoUrl: 'https://cdn.example.com/default-720.mp4',
        manifest: {
          adaptationSet: [
            {
              representation: [
                {
                  url: 'https://cdn.example.com/stream-1080.mp4',
                  width: 1080,
                  height: 1920,
                  avgBitrate: 2600,
                  qualityType: '1080p',
                  qualityLabel: '超清',
                },
                {
                  url: 'https://cdn.example.com/stream-720.mp4',
                  width: 720,
                  height: 1280,
                  avgBitrate: 1500,
                  qualityType: '720p',
                  qualityLabel: '高清',
                },
                {
                  url: 'https://cdn.example.com/stream-540.mp4',
                  width: 540,
                  height: 960,
                  avgBitrate: 900,
                  qualityType: '540p',
                  qualityLabel: '标清',
                },
              ],
            },
          ],
        },
      },
    };

    const info = await (parser as any).buildVideoInfoFromVisionDetail(detail);

    expect(info.videoUrl).toBe('https://cdn.example.com/stream-1080.mp4');
    expect(info.downloadOptions?.merged?.['1080p']).toBe(
      'https://cdn.example.com/stream-1080.mp4',
    );
    expect(info.downloadOptions?.merged?.['720p']).toBe(
      'https://cdn.example.com/stream-720.mp4',
    );
    expect(info.downloadOptions?.merged?.['540p']).toBe(
      'https://cdn.example.com/stream-540.mp4',
    );
  });

  it('prefers h264 when h264 and hevc are same quality', async () => {
    const detail = {
      author: {
        name: '测试作者',
      },
      photo: {
        id: 'photo_2',
        caption: '同档编码测试',
        coverUrl: 'https://example.com/cover.jpg',
        duration: 8000,
        photoUrl: 'https://cdn.example.com/default.mp4',
        videoResource: {
          h264: {
            adaptationSet: [
              {
                representation: [
                  {
                    url: 'https://cdn.example.com/h264-720.mp4',
                    qualityType: '720p',
                    qualityLabel: '高清',
                    width: 720,
                    height: 1280,
                    avgBitrate: 1400,
                  },
                ],
              },
            ],
          },
          hevc: {
            adaptationSet: [
              {
                representation: [
                  {
                    url: 'https://cdn.example.com/hevc-720.mp4',
                    qualityType: '720p',
                    qualityLabel: '高清',
                    width: 720,
                    height: 1280,
                    avgBitrate: 1200,
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const info = await (parser as any).buildVideoInfoFromVisionDetail(detail);
    expect(info.downloadOptions?.merged?.['720p']).toBe(
      'https://cdn.example.com/h264-720.mp4',
    );
  });

  it('uses h264 m3u8 as preview url but keeps progressive mp4 for download when same quality is mixed', async () => {
    const detail = {
      author: {
        name: '测试作者',
      },
      photo: {
        id: 'photo_3',
        caption: 'mp4 优先测试',
        coverUrl: 'https://example.com/cover.jpg',
        duration: 12000,
        manifest: {
          adaptationSet: [
            {
              representation: [
                {
                  url: 'https://cdn.example.com/h264-720.m3u8',
                  backupUrl: ['https://cdn-b.example.com/h264-720.m3u8'],
                  qualityType: '720p',
                  qualityLabel: '高清',
                  width: 720,
                  height: 1280,
                  avgBitrate: 1500,
                },
              ],
            },
          ],
        },
        videoResource: {
          hevc: {
            adaptationSet: [
              {
                representation: [
                  {
                    url: 'https://cdn.example.com/hevc-720.mp4',
                    backupUrl: ['https://cdn-b.example.com/hevc-720.mp4'],
                    qualityType: '720p',
                    qualityLabel: '高清',
                    width: 720,
                    height: 1280,
                    avgBitrate: 1300,
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const info = await (parser as any).buildVideoInfoFromVisionDetail(detail);
    expect(info.videoUrl).toMatch(/\.m3u8(\?|$)/i);
    expect(info.downloadOptions?.merged?.['720p']).toMatch(/\.mp4(\?|$)/i);
  });

  it('reuses cached parse result for the same photo id', async () => {
    jest.spyOn(parser as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(parser as any, 'resolveShareUrl').mockResolvedValue(
      'https://www.kuaishou.com/short-video/photo_cache_1?shareToken=abc',
    );

    expect(typeof (parser as any).fetchVisionVideoDetailViaGraphql).toBe('function');
    if (typeof (parser as any).fetchVisionVideoDetailViaGraphql !== 'function') {
      return;
    }
    const fetchSpy = jest
      .spyOn(parser as any, 'fetchVisionVideoDetailViaGraphql')
      .mockResolvedValue({
        status: 1,
        author: { name: '缓存作者' },
        photo: {
          id: 'photo_cache_1',
          caption: '缓存视频',
          coverUrl: 'https://example.com/cover.jpg',
          duration: 10000,
          photoUrl: 'https://example.com/video.mp4',
          manifest: {
            adaptationSet: [
              {
                representation: [
                  {
                    url: 'https://example.com/video.mp4',
                    width: 720,
                    height: 1280,
                    qualityType: '720p',
                    qualityLabel: '高清',
                    avgBitrate: 1000,
                  },
                ],
              },
            ],
          },
        },
      });

    const first = await parser.parse('https://www.kuaishou.com/f/abc123');
    const second = await parser.parse('https://www.kuaishou.com/f/abc123');

    expect(first.videoUrl).toBe('https://example.com/video.mp4');
    expect(second.videoUrl).toBe('https://example.com/video.mp4');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('enters cooldown immediately after risk-control error when threshold is reached', async () => {
    jest.spyOn(parser as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(parser as any, 'resolveShareUrl').mockResolvedValue(
      'https://www.kuaishou.com/short-video/photo_risk_1?shareToken=abc',
    );
    expect(typeof (parser as any).fetchVisionVideoDetailViaGraphql).toBe('function');
    if (typeof (parser as any).fetchVisionVideoDetailViaGraphql !== 'function') {
      return;
    }
    const fetchSpy = jest
      .spyOn(parser as any, 'fetchVisionVideoDetailViaGraphql')
      .mockRejectedValue(
        new ParserFailureError({
          code: 'KUAISHOU_RISK_CONTROL',
          message: 'risk-control',
          category: 'risk_control',
          retryable: true,
          platform: 'kuaishou',
        }),
      );

    await expect(
      parser.parse('https://www.kuaishou.com/f/risk123'),
    ).rejects.toMatchObject({
      code: 'KUAISHOU_RISK_CONTROL',
    });

    fetchSpy.mockClear();

    await expect(
      parser.parse('https://www.kuaishou.com/f/risk123'),
    ).rejects.toMatchObject({
      code: 'KUAISHOU_RISK_CONTROL',
      details: expect.objectContaining({
        retryAfterSeconds: expect.any(Number),
      }),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to html payload when graphql detail is empty', async () => {
    jest.spyOn(parser as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(parser as any, 'resolveShareUrl').mockResolvedValue(
      'https://www.kuaishou.com/short-video/photo_html_1?shareToken=abc',
    );
    expect(typeof (parser as any).fetchVisionVideoDetailViaGraphql).toBe('function');
    expect(typeof (parser as any).fetchVisionVideoDetailFromHtml).toBe('function');
    if (
      typeof (parser as any).fetchVisionVideoDetailViaGraphql !== 'function' ||
      typeof (parser as any).fetchVisionVideoDetailFromHtml !== 'function'
    ) {
      return;
    }

    jest
      .spyOn(parser as any, 'fetchVisionVideoDetailViaGraphql')
      .mockResolvedValue(null);
    const htmlFallbackSpy = jest
      .spyOn(parser as any, 'fetchVisionVideoDetailFromHtml')
      .mockResolvedValue({
        status: 1,
        author: { name: 'HTML 兜底作者' },
        photo: {
          id: 'photo_html_1',
          caption: 'HTML 兜底成功',
          coverUrl: 'https://example.com/cover.jpg',
          duration: 8000,
          photoUrl: 'https://example.com/html-fallback.mp4',
        },
      });

    const result = await parser.parse('https://www.kuaishou.com/f/html123');

    expect(result.videoUrl).toBe('https://example.com/html-fallback.mp4');
    expect(htmlFallbackSpy).toHaveBeenCalledTimes(1);
  });

  it('throws auth required when kuaishou cookie is missing', async () => {
    kuaishouAuthService.getCookieHeader.mockResolvedValueOnce('');

    await expect(
      parser.parse('https://www.kuaishou.com/f/no-cookie'),
    ).rejects.toMatchObject({
      code: 'KUAISHOU_AUTH_REQUIRED',
    });
  });
});
