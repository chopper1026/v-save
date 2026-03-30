import { shouldUseIosCompatibleFirstAttempt } from '../../../mobile/src/lib/ios-bilibili-smart-start';

describe('iOS Bilibili smart first attempt', () => {
  const buildParsedVideo = (overrides: Record<string, any> = {}) => ({
    title: 'test',
    cover: '',
    duration: '00:10',
    platform: 'bilibili',
    author: '',
    videoUrl: 'https://example.com/default.mp4',
    downloadOptions: {
      video: {
        '1080p': 'https://example.com/1080-hevc.m4s',
      },
      videoCandidates: {
        '1080p': [
          {
            url: 'https://example.com/1080-hevc.m4s',
            codecid: 12,
            width: 1920,
            height: 1080,
            frameRate: 60,
            bandwidth: 1800000,
          },
          {
            url: 'https://example.com/1080-avc.m4s',
            codecid: 7,
            width: 1920,
            height: 1080,
            frameRate: 30,
            bandwidth: 1000000,
          },
        ],
      },
      audio: {
        '192k': 'https://example.com/aac.m4a',
      },
    },
    ...overrides,
  });

  it('returns false for non-iOS platform', () => {
    const parsedVideo = buildParsedVideo();
    expect(
      shouldUseIosCompatibleFirstAttempt({
        parsedVideo: parsedVideo as any,
        targetQuality: '1080p',
        format: 'video',
        os: 'android',
      }),
    ).toBe(false);
  });

  it('returns false for non-bilibili platform', () => {
    const parsedVideo = buildParsedVideo({ platform: 'douyin' });
    expect(
      shouldUseIosCompatibleFirstAttempt({
        parsedVideo: parsedVideo as any,
        targetQuality: '1080p',
        format: 'video',
        os: 'ios',
      }),
    ).toBe(false);
  });

  it('returns false for audio format', () => {
    const parsedVideo = buildParsedVideo();
    expect(
      shouldUseIosCompatibleFirstAttempt({
        parsedVideo: parsedVideo as any,
        targetQuality: '1080p',
        format: 'audio',
        os: 'ios',
      }),
    ).toBe(false);
  });

  it('returns true when default candidate is non-AVC', () => {
    const parsedVideo = buildParsedVideo();
    expect(
      shouldUseIosCompatibleFirstAttempt({
        parsedVideo: parsedVideo as any,
        targetQuality: '1080p',
        format: 'video',
        os: 'ios',
      }),
    ).toBe(true);
  });

  it('returns false when default candidate is AVC', () => {
    const parsedVideo = buildParsedVideo({
      downloadOptions: {
        video: {
          '1080p': 'https://example.com/1080-avc.m4s',
        },
        videoCandidates: {
          '1080p': [
            {
              url: 'https://example.com/1080-avc.m4s',
              codecid: 7,
              width: 1920,
              height: 1080,
              frameRate: 30,
              bandwidth: 1000000,
            },
            {
              url: 'https://example.com/1080-hevc.m4s',
              codecid: 12,
              width: 1920,
              height: 1080,
              frameRate: 60,
              bandwidth: 1800000,
            },
          ],
        },
      },
    });

    expect(
      shouldUseIosCompatibleFirstAttempt({
        parsedVideo: parsedVideo as any,
        targetQuality: '1080p',
        format: 'video',
        os: 'ios',
      }),
    ).toBe(false);
  });

  it('returns false when candidate map is missing or unmatched', () => {
    const parsedVideo = buildParsedVideo({
      downloadOptions: {
        video: {
          '1080p': 'https://example.com/1080-hevc.m4s',
        },
        videoCandidates: {
          '1080p': [
            {
              url: 'https://example.com/other.m4s',
              codecid: 12,
            },
          ],
        },
      },
    });

    expect(
      shouldUseIosCompatibleFirstAttempt({
        parsedVideo: parsedVideo as any,
        targetQuality: '1080p',
        format: 'video',
        os: 'ios',
      }),
    ).toBe(false);
  });

  it('applies fallback quality chain and still detects non-AVC default', () => {
    const parsedVideo = buildParsedVideo({
      downloadOptions: {
        video: {
          '720p': 'https://example.com/720-hevc.m4s',
        },
        videoCandidates: {
          '720p': [
            {
              url: 'https://example.com/720-hevc.m4s',
              codecid: 12,
              width: 1280,
              height: 720,
              frameRate: 30,
              bandwidth: 900000,
            },
            {
              url: 'https://example.com/720-avc.m4s',
              codecid: 7,
              width: 1280,
              height: 720,
              frameRate: 30,
              bandwidth: 800000,
            },
          ],
        },
      },
    });

    expect(
      shouldUseIosCompatibleFirstAttempt({
        parsedVideo: parsedVideo as any,
        targetQuality: '1080p',
        format: 'video',
        os: 'ios',
      }),
    ).toBe(true);
  });
});
