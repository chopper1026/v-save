import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import {
  detectObservedPlatformFromUrl,
  normalizeObservedErrorCode,
} from './observability.utils';

describe('detectObservedPlatformFromUrl', () => {
  it('treats douyinvod direct cdn urls as douyin', () => {
    expect(
      detectObservedPlatformFromUrl(
        'https://v26-web.douyinvod.com/path/video.mp4?a=6383&mime_type=video_mp4',
      ),
    ).toBe('douyin');
  });
});

describe('normalizeObservedErrorCode', () => {
  it('extracts business error codes from Nest HTTP exceptions', () => {
    expect(
      normalizeObservedErrorCode(
        new BadRequestException({
          code: 'PARSE_URL_NOT_FOUND',
          message: '未检测到可解析的视频链接',
        }),
      ),
    ).toBe('PARSE_URL_NOT_FOUND');

    expect(
      normalizeObservedErrorCode(
        new ForbiddenException({
          code: 'FREE_LIMIT_REACHED',
          message: '今日次数已用完',
        }),
      ),
    ).toBe('FREE_LIMIT_REACHED');
  });

  it('falls back to HTTP status for upstream-style errors without explicit code', () => {
    expect(
      normalizeObservedErrorCode({
        response: {
          status: 403,
          data: {
            message: 'Request failed',
          },
        },
      }),
    ).toBe('HTTP_403');
  });
});
