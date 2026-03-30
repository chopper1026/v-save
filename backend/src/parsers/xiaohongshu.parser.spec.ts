import axios from 'axios';
import { ParserFailureError } from './parser-failure.error';
import { XiaohongshuParser } from './xiaohongshu.parser';

describe('XiaohongshuParser', () => {
  let parser: XiaohongshuParser;
  const sampleUrl =
    'https://www.xiaohongshu.com/discovery/item/69b4e9eb000000001b00005f?source=webshare';

  beforeEach(() => {
    parser = new XiaohongshuParser();
    jest.restoreAllMocks();
  });

  it('supports xhslink and xhsc share urls', () => {
    expect(parser.supports('https://xhslink.com/a/abc123')).toBe(true);
    expect(parser.supports('https://xhsc.cn/abc123')).toBe(true);
    expect(parser.supports('https://example.com/video/1')).toBe(false);
  });

  it('extracts note id from discovery share url', () => {
    const noteId = (parser as any).extractNoteId(
      'https://www.xiaohongshu.com/discovery/item/69b4e9eb000000001b00005f?source=webshare',
    );

    expect(noteId).toBe('69b4e9eb000000001b00005f');
  });

  it('builds download options from yt-dlp payload', () => {
    const parserAny = parser as any;

    const result = parserAny.buildDownloadOptionsFromYtDlpPayload({
      formats: [
        {
          ext: 'mp4',
          height: 720,
          tbr: 1400,
          vcodec: 'avc1',
          acodec: 'mp4a',
          url: 'https://cdn.example.com/merged-720.mp4',
        },
        {
          ext: 'mp4',
          height: 1080,
          tbr: 2600,
          vcodec: 'avc1',
          acodec: 'none',
          url: 'https://cdn.example.com/video-1080.mp4',
        },
        {
          ext: 'm4a',
          abr: 192,
          vcodec: 'none',
          acodec: 'mp4a',
          url: 'https://cdn.example.com/audio-192.m4a',
        },
      ],
    });

    expect(result.downloadOptions?.merged?.['720p']).toBe(
      'https://cdn.example.com/merged-720.mp4',
    );
    expect(result.downloadOptions?.video?.['1080p']).toBe(
      'https://cdn.example.com/video-1080.mp4',
    );
    expect(result.downloadOptions?.audio?.['192k']).toBe(
      'https://cdn.example.com/audio-192.m4a',
    );
    expect(result.bestMergedUrl).toBe('https://cdn.example.com/merged-720.mp4');
    expect(result.bestAudioUrl).toBe('https://cdn.example.com/audio-192.m4a');
  });

  it('throws parser failure when no playable video url can be resolved', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    await expect(
      parser.parse(
        'https://www.xiaohongshu.com/discovery/item/69b4e9eb000000001b00005f?source=webshare',
      ),
    ).rejects.toBeInstanceOf(ParserFailureError);

    await expect(
      parser.parse(
        'https://www.xiaohongshu.com/discovery/item/69b4e9eb000000001b00005f?source=webshare',
      ),
    ).rejects.toMatchObject({
      code: 'XHS_VIDEO_UNAVAILABLE',
    });
  });

  it('reuses cached parse result for the same note id', async () => {
    const parserAny = parser as any;
    const mockedInfo = {
      title: '缓存命中',
      cover: 'https://example.com/cover.jpg',
      duration: '00:12',
      platform: 'xiaohongshu',
      author: 'tester',
      description: '',
      videoUrl: 'https://cdn.example.com/video.mp4',
      downloadOptions: {
        merged: {
          '720p': 'https://cdn.example.com/video.mp4',
        },
      },
    };

    jest.spyOn(parserAny, 'resolveShareUrl').mockResolvedValue(sampleUrl);
    const ytDlpSpy = jest
      .spyOn(parserAny, 'getVideoInfoFromYtDlp')
      .mockResolvedValue(mockedInfo);

    const first = await parser.parse(sampleUrl);
    const second = await parser.parse(sampleUrl);

    expect(first.videoUrl).toBe(mockedInfo.videoUrl);
    expect(second.videoUrl).toBe(mockedInfo.videoUrl);
    expect(ytDlpSpy).toHaveBeenCalledTimes(1);
  });

  it('retries when parser failure is retryable and eventually succeeds', async () => {
    const parserAny = parser as any;
    const mockedInfo = {
      title: '重试成功',
      cover: 'https://example.com/cover.jpg',
      duration: '00:15',
      platform: 'xiaohongshu',
      author: 'tester',
      description: '',
      videoUrl: 'https://cdn.example.com/retried.mp4',
      downloadOptions: {
        merged: {
          '720p': 'https://cdn.example.com/retried.mp4',
        },
      },
    };

    jest.spyOn(parserAny, 'resolveShareUrl').mockResolvedValue(sampleUrl);
    jest.spyOn(parserAny, 'getVideoInfoFromYtDlp').mockResolvedValue(null);
    const webSpy = jest
      .spyOn(parserAny, 'getVideoInfoFromWeb')
      .mockRejectedValueOnce(
        new ParserFailureError({
          code: 'XHS_RISK_CONTROL',
          message: 'risk-control',
          category: 'risk_control',
          retryable: true,
          platform: 'xiaohongshu',
        }),
      )
      .mockResolvedValueOnce(mockedInfo);

    const result = await parser.parse(sampleUrl);

    expect(result.videoUrl).toBe(mockedInfo.videoUrl);
    expect(webSpy).toHaveBeenCalledTimes(2);
  });

  it('caches non-retryable parse failure to avoid repeated upstream probing', async () => {
    const parserAny = parser as any;
    jest.spyOn(parserAny, 'resolveShareUrl').mockResolvedValue(sampleUrl);
    const ytDlpSpy = jest.spyOn(parserAny, 'getVideoInfoFromYtDlp').mockResolvedValue(null);
    jest.spyOn(parserAny, 'getVideoInfoFromWeb').mockResolvedValue(null);
    jest.spyOn(parserAny, 'getVideoInfoFromApi').mockResolvedValue(null);

    await expect(parser.parse(sampleUrl)).rejects.toMatchObject({
      code: 'XHS_VIDEO_UNAVAILABLE',
    });
    await expect(parser.parse(sampleUrl)).rejects.toMatchObject({
      code: 'XHS_VIDEO_UNAVAILABLE',
    });

    expect(ytDlpSpy).toHaveBeenCalledTimes(1);
  });

  it('enriches yt-dlp metadata with web author and better cover', async () => {
    const parserAny = parser as any;
    const ytDlpInfo = {
      title: '🌧️🌧️🌧️',
      cover:
        'http://sns-webpic-qc.xhscdn.com/202603151724/abc/1040g00831tmbp4u16o005nt4se308p4chvlq1f0!nd_dft_wlteh_jpg_3',
      duration: '00:13',
      platform: 'xiaohongshu',
      author: '',
      description: '#今天不一样[话题]#',
      videoUrl:
        'http://sns-video-hs.xhscdn.com/stream/1/110/258/01e9b4e9d0c5c6d2010370019ceab1f19e_258.mp4',
      downloadOptions: {
        merged: {
          '1080p':
            'http://sns-video-hs.xhscdn.com/stream/1/110/258/01e9b4e9d0c5c6d2010370019ceab1f19e_258.mp4',
        },
      },
    };
    const webInfo = {
      title: '🌧️🌧️🌧️',
      cover:
        'http://sns-webpic-qc.xhscdn.com/202603151724/34e8d3d0dc2f9842a908b1e2e567500e/1040g00831tmbp4u16o005nt4se308p4chvlq1f0!nd_prv_wlteh_jpg_3',
      duration: '00:13',
      platform: 'xiaohongshu',
      author: '甜贝',
      description: '#今天不一样[话题]#',
      videoUrl:
        'http://sns-video-hs.xhscdn.com/stream/1/110/258/01e9b4e9d0c5c6d2010370019ceab1f19e_258.mp4',
    };

    jest.spyOn(parserAny, 'resolveShareUrl').mockResolvedValue(
      `${sampleUrl}&xsec_token=token&xsec_source=pc_share`,
    );
    jest.spyOn(parserAny, 'getVideoInfoFromYtDlp').mockResolvedValue(ytDlpInfo);
    jest.spyOn(parserAny, 'getVideoInfoFromWeb').mockResolvedValue(webInfo);
    const apiSpy = jest.spyOn(parserAny, 'getVideoInfoFromApi');

    const result = await parser.parse(sampleUrl);

    expect(result.videoUrl).toBe(ytDlpInfo.videoUrl);
    expect(result.author).toBe('甜贝');
    expect(result.cover).toContain('!nd_dft_wlteh_jpg_3');
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('parses assigned state object that contains undefined values', () => {
    const parserAny = parser as any;
    const html = [
      '<script>',
      'window.__INITIAL_STATE__={"user":{"nickname":"甜贝"},"extra":undefined,"note":{"id":"xhs"}};',
      '</script>',
    ].join('');

    const state = parserAny.extractAssignedObject(html, 'window.__INITIAL_STATE__');

    expect(state).toBeTruthy();
    expect(state.user.nickname).toBe('甜贝');
    expect(state.extra).toBeNull();
  });

  it('prefers urlDefault cover from image list when extracting note data', () => {
    const parserAny = parser as any;
    const info = parserAny.extractNoteData({
      noteId: 'abc',
      title: 'test',
      user: { nickname: 'tester' },
      imageList: [
        {
          url: '',
          urlDefault: 'http://cdn.example.com/cover-default!nd_dft_wlteh_jpg_3',
          urlPre: 'http://cdn.example.com/cover-pre!nd_prv_wlteh_jpg_3',
        },
      ],
      video: {
        duration: 12000,
      },
      media: {
        stream: {
          h264: [
            {
              masterUrl: 'http://cdn.example.com/video.mp4',
            },
          ],
        },
      },
    });

    expect(info).toBeTruthy();
    expect(info.cover).toContain('cover-default');
  });


  it('extracts fallback duration from nested media fields and marks single-source quality', () => {
    const parserAny = parser as any;
    const info = parserAny.extractNoteData({
      title: 'fallback note',
      user: { nickname: 'tester' },
      media: {
        durationMs: 12500,
        stream: {
          masterUrl: 'https://cdn.example.com/single-source.mp4',
        },
      },
    });

    expect(info).toBeTruthy();
    expect(info.duration).toBe('00:13');
    expect(info.downloadOptions?.merged?.source).toBe('https://cdn.example.com/single-source.mp4');
    expect(info.qualityStatus).toBe('source_single_quality');
    expect(info.qualityMessage).toContain('单路视频');
  });

  it('prefers explicit height metadata over digits guessed from video url', () => {
    const parserAny = parser as any;
    const info = parserAny.extractNoteData({
      title: 'quality by height',
      user: { nickname: 'tester' },
      video: {
        duration: 12000,
        height: 720,
        playAddr: 'https://cdn.example.com/video-2160-demo.mp4',
      },
    });

    expect(info).toBeTruthy();
    expect(info.downloadOptions?.merged?.['720p']).toBe('https://cdn.example.com/video-2160-demo.mp4');
    expect(info.qualityStatus).toBeUndefined();
  });

  it('maps portrait dimensions by the shorter edge instead of the taller edge', () => {
    const parserAny = parser as any;
    const info = parserAny.extractNoteData({
      title: 'portrait quality',
      user: { nickname: 'tester' },
      video: {
        duration: 12000,
        width: 720,
        height: 1280,
        playAddr: 'https://cdn.example.com/video-portrait.mp4',
      },
    });

    expect(info).toBeTruthy();
    expect(info.downloadOptions?.merged?.['720p']).toBe('https://cdn.example.com/video-portrait.mp4');
    expect(info.downloadOptions?.merged?.['1080p']).toBeUndefined();
  });

  it('returns placeholder duration when fallback duration metadata is unavailable', () => {
    const parserAny = parser as any;
    const info = parserAny.extractNoteData({
      title: 'unknown duration',
      user: { nickname: 'tester' },
      media: {
        stream: {
          h264: [
            {
              masterUrl: 'https://cdn.example.com/unknown-duration.mp4',
            },
          ],
        },
      },
    });

    expect(info).toBeTruthy();
    expect(info.duration).toBe('--:--');
    expect(info.downloadOptions?.merged?.source).toBe('https://cdn.example.com/unknown-duration.mp4');
  });
});
