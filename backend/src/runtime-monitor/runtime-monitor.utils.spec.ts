import { describe, expect, it } from '@jest/globals';
import { detectRuntimePlatformFromUrl } from './runtime-monitor.utils';

describe('detectRuntimePlatformFromUrl', () => {
  it('treats douyinvod direct cdn urls as douyin', () => {
    expect(
      detectRuntimePlatformFromUrl(
        'https://v26-web.douyinvod.com/path/video.mp4?a=6383&mime_type=video_mp4',
      ),
    ).toBe('douyin');
  });
});
