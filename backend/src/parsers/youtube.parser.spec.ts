import axios from 'axios';
import { YoutubeParser } from './youtube.parser';

describe('YoutubeParser', () => {
  let parser: YoutubeParser;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    parser = new YoutubeParser();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('prefers progressive formats over adaptive-only formats', () => {
    const url = (parser as any).getBestVideoUrl({
      formats: [
        { height: 720, url: 'https://example.com/progressive-720.mp4' },
      ],
      adaptiveFormats: [
        { height: 1080, url: 'https://example.com/adaptive-1080.mp4' },
      ],
    });

    expect(url).toBe('https://example.com/progressive-720.mp4');
  });

  it('builds quality download options from yt-dlp payload', () => {
    const parserAny = parser as any;

    const result = parserAny.buildDownloadOptionsFromYtDlpPayload({
      formats: [
        {
          ext: 'mp4',
          height: 360,
          tbr: 500,
          vcodec: 'avc1',
          acodec: 'mp4a',
          url: 'https://example.com/merged-360.mp4',
        },
        {
          ext: 'mp4',
          height: 720,
          tbr: 1500,
          vcodec: 'avc1',
          acodec: 'none',
          url: 'https://example.com/video-720.mp4',
        },
        {
          ext: 'm4a',
          abr: 192,
          vcodec: 'none',
          acodec: 'mp4a',
          url: 'https://example.com/audio-192.m4a',
        },
      ],
    });

    expect(result.downloadOptions?.merged?.['360p']).toBe(
      'https://example.com/merged-360.mp4',
    );
    expect(result.downloadOptions?.video?.['720p']).toBe(
      'https://example.com/video-720.mp4',
    );
    expect(result.downloadOptions?.audio?.['192k']).toBe(
      'https://example.com/audio-192.m4a',
    );
    expect(result.bestMergedUrl).toBe('https://example.com/merged-360.mp4');
    expect(result.bestAudioUrl).toBe('https://example.com/audio-192.m4a');
  });

  it('falls back to yt-dlp when the parser url is not playable', async () => {
    const parserAny = parser as any;

    jest
      .spyOn(parserAny, 'isPlayableVideoUrl')
      .mockResolvedValue(false);

    jest
      .spyOn(parserAny, 'getPlayableVideoUrlByYtDlp')
      .mockResolvedValue('https://example.com/ytdlp.mp4');

    const resolved = await parserAny.resolvePlayableVideoUrl(
      'https://www.youtube.com/watch?v=xGHI8GYy1V0',
      'https://example.com/unplayable.mp4',
    );

    expect(resolved).toBe('https://example.com/ytdlp.mp4');
  });

  it('does not fail when noembed is unavailable but page data is available', async () => {
    const parserAny = parser as any;

    jest
      .spyOn(parserAny, 'getYtDlpStreamOptions')
      .mockResolvedValue({});

    jest
      .spyOn(parserAny, 'resolvePlayableVideoUrl')
      .mockResolvedValue('https://example.com/playable.mp4');

    const playerResponse = {
      videoDetails: {
        title: 'test-title',
        author: 'test-author',
        lengthSeconds: '120',
        shortDescription: 'test-desc',
        thumbnail: {
          thumbnails: [{ url: 'https://example.com/cover.jpg' }],
        },
      },
      streamingData: {
        formats: [{ height: 720, url: 'https://example.com/raw.mp4' }],
      },
    };

    const html = `<html><body><script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script></body></html>`;

    jest
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(new Error('noembed down'))
      .mockResolvedValueOnce({ data: html } as any);

    const result = await parserAny.getVideoInfo('xGHI8GYy1V0');

    expect(result.title).toBe('test-title');
    expect(result.videoUrl).toBe('https://example.com/playable.mp4');
    expect(result.author).toBe('test-author');
  });

  it('returns minimal info with playable url when both noembed and page requests fail', async () => {
    const parserAny = parser as any;

    jest
      .spyOn(parserAny, 'getYtDlpStreamOptions')
      .mockResolvedValue({});

    jest
      .spyOn(parserAny, 'resolvePlayableVideoUrl')
      .mockResolvedValue('https://example.com/ytdlp-only.mp4');

    jest
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(new Error('noembed down'))
      .mockRejectedValueOnce(new Error('page down'));

    const result = await parserAny.getVideoInfo('xGHI8GYy1V0');

    expect(result.videoUrl).toBe('https://example.com/ytdlp-only.mp4');
    expect(result.title).toContain('xGHI8GYy1V0');
    expect(result.platform).toBe('youtube');
  });

  it('skips noembed requests entirely when YOUTUBE_NOEMBED_ENABLED is false', async () => {
    process.env.YOUTUBE_NOEMBED_ENABLED = 'false';
    parser = new YoutubeParser();
    const parserAny = parser as any;

    jest
      .spyOn(parserAny, 'getYtDlpStreamOptions')
      .mockResolvedValue({});

    jest
      .spyOn(parserAny, 'resolvePlayableVideoUrl')
      .mockResolvedValue('https://example.com/ytdlp-only.mp4');

    jest
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(new Error('page down'));

    const result = await parserAny.getVideoInfo('xGHI8GYy1V0');

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(result.videoUrl).toBe('https://example.com/ytdlp-only.mp4');
    expect(result.title).toContain('xGHI8GYy1V0');
  });
});
