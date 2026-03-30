import axios from 'axios';
import { DouyinOfficialDetailService } from './douyin-official-detail.service';

jest.mock('axios');

describe('DouyinOfficialDetailService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const signatureService = {
    generateABogus: jest.fn(),
    generateMsToken: jest.fn(),
  };
  let service: DouyinOfficialDetailService;

  beforeEach(() => {
    jest.clearAllMocks();
    signatureService.generateABogus.mockResolvedValue(
      'YJRZ/5wgmEfsDVWg54VLfY3q6l8VYmB-',
    );
    signatureService.generateMsToken.mockReturnValue('m'.repeat(126) + '==');
    service = new DouyinOfficialDetailService(signatureService as any);
  });

  it('requests official detail with current params and maps complete quality options', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        aweme_detail: {
          desc: '4k sample',
          author: { nickname: 'tester' },
          music: {
            play_url: {
              url_info: [{ url: 'https://example.com/audio.m4a' }],
            },
          },
          video: {
            height: 3840,
            width: 2160,
            duration: 10000,
            cover: { url_list: ['https://example.com/cover.jpg'] },
            play_addr: {
              url_list: [
                'https://example.com/video-default.mp4?ratio=720p',
              ],
            },
            bit_rate: [
              {
                gear_name: 'adapt_lowest_4_1',
                bit_rate: 2834133,
                FPS: 30,
                play_addr: {
                  height: 3840,
                  width: 2160,
                  url_list: ['https://example.com/video-4k.mp4'],
                },
              },
              {
                gear_name: 'adapt_lowest_1440_1',
                bit_rate: 1942944,
                FPS: 30,
                play_addr: {
                  height: 2560,
                  width: 1440,
                  url_list: ['https://example.com/video-1440.mp4'],
                },
              },
              {
                gear_name: 'adapt_lowest_1080_1',
                bit_rate: 1103604,
                FPS: 30,
                play_addr: {
                  height: 1920,
                  width: 1080,
                  url_list: ['https://example.com/video-1080.mp4'],
                },
              },
              {
                gear_name: 'normal_720_0',
                bit_rate: 1477367,
                FPS: 30,
                play_addr: {
                  height: 1280,
                  width: 720,
                  url_list: ['https://example.com/video-720.mp4'],
                },
              },
              {
                gear_name: 'low_540_0',
                bit_rate: 1242736,
                FPS: 30,
                play_addr: {
                  height: 1024,
                  width: 576,
                  url_list: ['https://example.com/video-540.mp4'],
                },
              },
            ],
          },
        },
      },
    } as any);

    const result = await service.fetchVideoInfo(
      '7617779361726336307',
      'sessionid=abc; ttwid=xyz; s_v_web_id=verify_test;',
    );

    expect(signatureService.generateMsToken).toHaveBeenCalledTimes(1);
    expect(signatureService.generateABogus).toHaveBeenCalledWith(
      expect.objectContaining({
        aid: '6383',
        version_code: '290100',
        version_name: '29.1.0',
        aweme_id: '7617779361726336307',
      }),
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/aweme/v1/web/aweme/detail/?'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'sessionid=abc; ttwid=xyz; s_v_web_id=verify_test;',
        }),
      }),
    );
    expect(result.downloadOptions?.merged).toEqual(
      expect.objectContaining({
        '4k': expect.stringContaining('video-4k.mp4'),
        '1440p': expect.stringContaining('video-1440.mp4'),
        '1080p': expect.stringContaining('video-1080.mp4'),
        '720p': expect.stringContaining('video-720.mp4'),
        '540p': expect.stringContaining('video-540.mp4'),
      }),
    );
    expect(result.downloadOptions?.videoCandidates?.['4k']?.[0]).toEqual(
      expect.objectContaining({
        url: expect.stringContaining('video-4k.mp4'),
        width: 2160,
        height: 3840,
        bandwidth: 2834133,
        frameRate: 30,
        fileId: expect.any(String),
        ratio: '4k',
        sourceKind: 'bit_rate',
      }),
    );
    expect(result.downloadOptions?.videoCandidates?.['1080p']?.[0]).toEqual(
      expect.objectContaining({
        url: expect.stringContaining('video-1080.mp4'),
        width: 1080,
        height: 1920,
        bandwidth: 1103604,
        frameRate: 30,
        fileId: expect.any(String),
        ratio: '1080p',
        sourceKind: 'bit_rate',
      }),
    );
  });

  it('infers vertical video qualities from the shorter edge when gear names are missing', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        aweme_detail: {
          desc: 'vertical sample',
          author: { nickname: 'tester' },
          music: {
            play_url: {
              url_info: [{ url: 'https://example.com/audio.m4a' }],
            },
          },
          video: {
            height: 3840,
            width: 2160,
            duration: 10000,
            play_addr: {
              url_list: ['https://example.com/video-default.mp4'],
            },
            bit_rate: [
              {
                gear_name: '',
                play_addr: {
                  height: 3840,
                  width: 2160,
                  url_list: ['https://example.com/video-4k.mp4'],
                },
              },
              {
                gear_name: '',
                play_addr: {
                  height: 2560,
                  width: 1440,
                  url_list: ['https://example.com/video-1440.mp4'],
                },
              },
              {
                gear_name: '',
                play_addr: {
                  height: 1920,
                  width: 1080,
                  url_list: ['https://example.com/video-1080.mp4'],
                },
              },
            ],
          },
        },
      },
    } as any);

    const result = await service.fetchVideoInfo(
      '7617779361726336307',
      'sessionid=abc; ttwid=xyz; s_v_web_id=verify_test;',
    );

    expect(result.downloadOptions?.merged).toEqual(
      expect.objectContaining({
        '4k': expect.stringContaining('video-4k.mp4'),
        '1440p': expect.stringContaining('video-1440.mp4'),
        '1080p': expect.stringContaining('video-1080.mp4'),
      }),
    );
  });

  it('prefers direct cdn urls over aweme play endpoints from official url_list', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        aweme_detail: {
          desc: 'direct cdn preferred',
          author: { nickname: 'tester' },
          music: {
            play_url: {
              url_info: [{ url: 'https://example.com/audio.m4a' }],
            },
          },
          video: {
            height: 1280,
            width: 720,
            duration: 10000,
            play_addr: {
              height: 1280,
              width: 720,
              url_list: [
                'https://cdn-a.example.com/video-720.mp4',
                'https://cdn-b.example.com/video-720.mp4',
                'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=play720&sign=play720',
              ],
            },
            bit_rate: [
              {
                gear_name: 'normal_720_0',
                bit_rate: 1477367,
                FPS: 30,
                play_addr: {
                  height: 1280,
                  width: 720,
                  url_list: [
                    'https://cdn-a.example.com/video-720.mp4',
                    'https://cdn-b.example.com/video-720.mp4',
                    'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=play720&sign=play720',
                  ],
                },
              },
            ],
          },
        },
      },
    } as any);

    const result = await service.fetchVideoInfo(
      '7617779361726336307',
      'sessionid=abc; ttwid=xyz; s_v_web_id=verify_test;',
    );

    expect(result.downloadOptions?.merged?.['720p']).toBe(
      'https://cdn-a.example.com/video-720.mp4',
    );
    expect(result.videoUrl).toBe('https://cdn-a.example.com/video-720.mp4');
    expect(result.downloadOptions?.videoCandidates?.['720p']?.[0]).toEqual(
      expect.objectContaining({
        url: 'https://cdn-a.example.com/video-720.mp4',
      }),
    );
  });

  it('preserves explicit watermark download_addr candidates without overriding non-watermark play addresses', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        aweme_detail: {
          desc: 'watermark metadata',
          author: { nickname: 'tester' },
          music: {
            play_url: {
              url_info: [{ url: 'https://example.com/audio.m4a' }],
            },
          },
          video: {
            height: 1280,
            width: 720,
            duration: 10000,
            play_addr: {
              height: 1280,
              width: 720,
              url_list: [
                'https://cdn.example.com/video-720.mp4',
                'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=play720&sign=play720',
              ],
            },
            download_addr: {
              height: 720,
              width: 720,
              data_size: 2584090,
              url_list: [
                'https://cdn.example.com/video-720-watermark.mp4',
                'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&ratio=720p&watermark=1&media_type=4',
              ],
            },
            bit_rate: [
              {
                gear_name: 'normal_720_0',
                bit_rate: 1477367,
                FPS: 30,
                play_addr: {
                  height: 1280,
                  width: 720,
                  url_list: [
                    'https://cdn.example.com/video-720.mp4',
                    'https://www.douyin.com/aweme/v1/play/?video_id=test-stream&line=0&file_id=play720&sign=play720',
                  ],
                },
              },
            ],
          },
        },
      },
    } as any);

    const result = await service.fetchVideoInfo(
      '7617779361726336307',
      'sessionid=abc; ttwid=xyz; s_v_web_id=verify_test;',
    );

    expect(result.downloadOptions?.merged?.['720p']).toBe(
      'https://cdn.example.com/video-720.mp4',
    );
    expect(result.downloadOptions?.videoCandidates?.['720p']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://cdn.example.com/video-720.mp4',
          sourceKind: 'bit_rate',
        }),
        expect.objectContaining({
          url: 'https://cdn.example.com/video-720-watermark.mp4',
          sourceKind: 'download_addr',
          watermark: true,
        }),
      ]),
    );
  });

  it('rejects anonymous official-detail requests without a douyin cookie', async () => {
    await expect(
      service.fetchVideoInfo('7617779361726336307', ''),
    ).rejects.toThrow(/cookie/i);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
