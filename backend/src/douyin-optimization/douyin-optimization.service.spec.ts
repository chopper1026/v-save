import { DouyinOptimizationService } from './douyin-optimization.service';

describe('DouyinOptimizationService', () => {
  let service: DouyinOptimizationService;

  beforeEach(() => {
    service = new DouyinOptimizationService();
  });

  it('builds merged quality map without losing this binding in quality ranking', () => {
    service.upsertFact({
      videoStreamId: 'stream-1',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '0',
      candidateUrl: 'https://example.com/1080-low.mp4',
      finalUrl: 'https://example.com/1080-low.mp4',
      actualUrl: 'https://example.com/1080-low.mp4',
      actualWidth: 720,
      actualHeight: 1280,
      usedWatermarkFallback: false,
      verifiedAt: Date.now() - 10,
    });
    service.upsertFact({
      videoStreamId: 'stream-1',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '4',
      candidateUrl: 'https://example.com/1080-best.mp4',
      finalUrl: 'https://example.com/1080-best.mp4',
      actualUrl: 'https://example.com/1080-best.mp4',
      actualWidth: 1080,
      actualHeight: 1920,
      usedWatermarkFallback: false,
      verifiedAt: Date.now(),
    });

    expect(() => service.buildMergedQualityMap('stream-1')).not.toThrow();
    expect(service.buildMergedQualityMap('stream-1')).toEqual({
      '1080p': 'https://example.com/1080-best.mp4',
    });
  });

  it('prefers non-watermark and higher actual quality facts when selecting best fact', () => {
    service.upsertFact({
      videoStreamId: 'stream-2',
      requestedQuality: '1080p',
      actualQuality: '720p',
      line: '0',
      candidateUrl: 'https://example.com/720-wm.mp4',
      finalUrl: 'https://example.com/720-wm.mp4',
      actualUrl: 'https://example.com/720-wm.mp4',
      actualWidth: 720,
      actualHeight: 1280,
      usedWatermarkFallback: true,
      verifiedAt: Date.now() - 100,
    });
    service.upsertFact({
      videoStreamId: 'stream-2',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '4',
      candidateUrl: 'https://example.com/1080.mp4',
      finalUrl: 'https://example.com/1080.mp4',
      actualUrl: 'https://example.com/1080.mp4',
      actualWidth: 1080,
      actualHeight: 1920,
      usedWatermarkFallback: false,
      verifiedAt: Date.now(),
    });

    const selected = service.selectBestFact({
      videoStreamId: 'stream-2',
      qualityOrder: ['1080p', '720p'],
      allowWatermarkFallback: false,
      getQualityRank: (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === '1080p') return 1080;
        if (normalized === '720p') return 720;
        return -1;
      },
    });

    expect(selected?.actualQuality).toBe('1080p');
    expect(selected?.usedWatermarkFallback).toBe(false);
  });

  it('prefers an exact requested quality fact over a higher upgraded fact', () => {
    service.upsertFact({
      videoStreamId: 'stream-3',
      requestedQuality: '1440p',
      actualQuality: '4k',
      line: '4',
      candidateUrl: 'https://example.com/1440-line4.mp4',
      finalUrl: 'https://example.com/4k.mp4',
      actualUrl: 'https://example.com/4k.mp4',
      actualWidth: 2160,
      actualHeight: 3840,
      usedWatermarkFallback: false,
      verifiedAt: Date.now() - 100,
    });
    service.upsertFact({
      videoStreamId: 'stream-3',
      requestedQuality: '1440p',
      actualQuality: '1440p',
      line: '0',
      candidateUrl: 'https://example.com/1440-line0.mp4',
      finalUrl: 'https://example.com/1440.mp4',
      actualUrl: 'https://example.com/1440.mp4',
      actualWidth: 1440,
      actualHeight: 2560,
      usedWatermarkFallback: false,
      verifiedAt: Date.now(),
    });

    const selected = service.selectBestFact({
      videoStreamId: 'stream-3',
      qualityOrder: ['1440p', '1080p', '720p', '4k'],
      allowWatermarkFallback: false,
      getQualityRank: (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === '4k') return 2160;
        if (normalized === '1440p') return 1440;
        if (normalized === '1080p') return 1080;
        if (normalized === '720p') return 720;
        return -1;
      },
    });

    expect(selected?.actualQuality).toBe('1440p');
    expect(selected?.actualUrl).toBe('https://example.com/1440.mp4');
  });

  it('does not return a fact when the requested official candidate identity does not match', () => {
    service.upsertFact({
      videoStreamId: 'stream-4',
      requestedQuality: '1080p',
      actualQuality: '1080p',
      line: '0',
      candidateUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=stream-4&file_id=alternate1080',
      finalUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=stream-4&file_id=alternate1080',
      actualUrl: 'https://cdn.example.com/alternate-1080.mp4',
      actualWidth: 1080,
      actualHeight: 1920,
      usedWatermarkFallback: false,
      verifiedAt: Date.now(),
    });

    const selected = (service as any).getFactForCandidate({
      videoStreamId: 'stream-4',
      requestedQuality: '1080p',
      candidateUrl:
        'https://www.douyin.com/aweme/v1/play/?video_id=stream-4&file_id=primary1080',
      allowWatermarkFallback: false,
    });

    expect(selected || null).toBeNull();
  });
});
