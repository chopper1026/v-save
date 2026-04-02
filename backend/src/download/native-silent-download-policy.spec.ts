import {
  resolveNativeSilentDownloadAuthPolicy,
  resolveNativeSilentDownloadQuality,
  shouldUseNativeSilentDownloadAsyncTask,
  shouldUseNativeSilentDownloadIosCompatibleFirstAttempt,
} from './native-silent-download-policy';

describe('native-silent-download-policy', () => {
  it('prefers the highest available merged or video quality for native silent download', () => {
    expect(
      resolveNativeSilentDownloadQuality({
        title: 'video',
        platform: 'bilibili',
        videoUrl: 'https://example.com/default.mp4',
        downloadOptions: {
          merged: {
            '720p': 'https://example.com/720.mp4',
          },
          video: {
            '1080p': 'https://example.com/1080-video.mp4',
            '4k': 'https://example.com/4k-video.mp4',
          },
        },
      } as any),
    ).toBe('4k');
  });

  it('uses async background task mode only for non-ios-compatible high-quality youtube downloads', () => {
    expect(
      shouldUseNativeSilentDownloadAsyncTask({
        platform: 'youtube',
        quality: '1080p',
        iosCompatible: false,
      }),
    ).toBe(true);

    expect(
      shouldUseNativeSilentDownloadAsyncTask({
        platform: 'youtube',
        quality: '1080p',
        iosCompatible: true,
      }),
    ).toBe(false);

    expect(
      shouldUseNativeSilentDownloadAsyncTask({
        platform: 'bilibili',
        quality: '1080p',
        iosCompatible: false,
      }),
    ).toBe(false);
  });

  it('starts bilibili native silent download with ios-compatible merge when default codec is not avc', () => {
    expect(
      shouldUseNativeSilentDownloadIosCompatibleFirstAttempt({
        parsedVideo: {
          title: 'bili',
          platform: 'bilibili',
          videoUrl: 'https://example.com/default.mp4',
          downloadOptions: {
            video: {
              '1080p': 'https://example.com/hevc.mp4',
            },
            videoCandidates: {
              '1080p': [
                {
                  url: 'https://example.com/hevc.mp4',
                  codecid: 12,
                },
                {
                  url: 'https://example.com/avc.mp4',
                  codecid: 7,
                },
              ],
            },
          },
        } as any,
        targetQuality: '1080p',
      }),
    ).toBe(true);
  });

  it('does not force ios-compatible merge when bilibili default candidate already uses avc', () => {
    expect(
      shouldUseNativeSilentDownloadIosCompatibleFirstAttempt({
        parsedVideo: {
          title: 'bili',
          platform: 'bilibili',
          videoUrl: 'https://example.com/default.mp4',
          downloadOptions: {
            video: {
              '1080p': 'https://example.com/avc.mp4',
            },
            videoCandidates: {
              '1080p': [
                {
                  url: 'https://example.com/avc.mp4',
                  codecid: 7,
                },
              ],
            },
          },
        } as any,
        targetQuality: '1080p',
      }),
    ).toBe(false);
  });

  it('requires bearer auth only for api-backed native silent download urls', () => {
    expect(
      resolveNativeSilentDownloadAuthPolicy(
        'https://api.example.com/api/download/merge?task=1',
      ),
    ).toBe('bearer');
    expect(
      resolveNativeSilentDownloadAuthPolicy(
        'https://api.example.com/api/download/tasks/task-1/file',
      ),
    ).toBe('bearer');
    expect(
      resolveNativeSilentDownloadAuthPolicy('https://cdn.example.com/video.mp4'),
    ).toBe('none');
  });
});
