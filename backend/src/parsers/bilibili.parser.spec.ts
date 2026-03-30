import { BilibiliParser } from './bilibili.parser';
import axios from 'axios';

describe('BilibiliParser quality mapping', () => {
  const parser = new BilibiliParser({
    getCookieHeader: async () => '',
  } as any);
  const waitForNextTick = () => new Promise((resolve) => setImmediate(resolve));

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps 300xx dash ids to canonical quality labels correctly', () => {
    const map = (parser as any).buildDashVideoMap([
      { id: 30016, url: 'url-360' },
      { id: 30032, url: 'url-480' },
      { id: 30064, url: 'url-720' },
      { id: 30080, url: 'url-1080' },
      { id: 30120, url: 'url-4k' },
    ]);

    expect(map['360p']).toBe('url-360');
    expect(map['480p']).toBe('url-480');
    expect(map['720p']).toBe('url-720');
    expect(map['1080p']).toBe('url-1080');
    expect(map['4k']).toBe('url-4k');
  });

  it('prefers higher resolution stream over higher bandwidth for same quality id', () => {
    const map = (parser as any).buildDashVideoMap([
      { id: 80, width: 1920, height: 872, bandwidth: 900000, url: 'url-1080-low-res' },
      { id: 80, width: 2378, height: 1080, bandwidth: 700000, url: 'url-1080-high-res' },
    ]);

    expect(map['1080p']).toBe('url-1080-high-res');
  });

  it('keeps frame-rate priority for default quality map selection', () => {
    const map = (parser as any).buildDashVideoMap([
      {
        id: 80,
        width: 1920,
        height: 1080,
        frameRate: '30.003',
        codecid: 12,
        bandwidth: 1200000,
        url: 'url-hevc',
      },
      {
        id: 80,
        width: 1920,
        height: 1080,
        frameRate: '30.000',
        codecid: 7,
        bandwidth: 1100000,
        url: 'url-avc',
      },
    ]);

    expect(map['1080p']).toBe('url-hevc');
  });

  it('sorts iOS candidates as AVC > frameRate > bandwidth under same resolution', () => {
    const candidateMap = (parser as any).buildDashVideoCandidateMap([
      {
        id: 80,
        width: 1920,
        height: 1080,
        frameRate: '60',
        codecid: 12,
        bandwidth: 1800000,
        url: 'url-hevc-60',
      },
      {
        id: 80,
        width: 1920,
        height: 1080,
        frameRate: '30',
        codecid: 7,
        bandwidth: 1000000,
        url: 'url-avc-30',
      },
      {
        id: 80,
        width: 1920,
        height: 1080,
        frameRate: '30',
        codecid: 12,
        bandwidth: 2200000,
        url: 'url-hevc-30',
      },
    ]);

    expect(candidateMap['1080p']?.[0]?.url).toBe('url-avc-30');
  });

  it('does not fill unavailable quality labels with fallback urls', async () => {
    const parserAny = parser as any;

    jest
      .spyOn(parserAny, 'fetchPlayUrlData')
      .mockResolvedValue({
        dash: {
          video: [{ id: 30080, url: 'url-1080-only' }],
        },
      });

    const result = await parserAny.expandDashVideoMapByQuality(1, 1, [120, 80, 64], {});

    expect(result['1080p']).toBe('url-1080-only');
    expect(result['4k']).toBeUndefined();
    expect(result['720p']).toBeUndefined();
  });

  it('logs structured parse timings on success', async () => {
    const parserAny = parser as any;

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        code: 0,
        data: {
          aid: 1,
          cid: 2,
          title: 'sample title',
          duration: 90,
          owner: { name: 'author' },
          desc: 'desc',
          pic: '//i0.hdslb.com/sample.jpg',
        },
      },
    } as any);
    jest.spyOn(parserAny, 'getPlaybackSources').mockResolvedValue({
      previewUrl: 'video-url',
      audioUrl: 'audio-url',
      downloadOptions: {},
    });
    const logSpy = jest.spyOn(parserAny.logger, 'log').mockImplementation();

    await parser.parse('https://www.bilibili.com/video/BV1xx411c7mD');

    const logEntry = logSpy.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes('"event":"bilibili_parse_timing"'));

    expect(logEntry).toBeTruthy();

    const payload = JSON.parse(logEntry as string);
    expect(payload.event).toBe('bilibili_parse_timing');
    expect(payload.bvid).toBe('BV1xx411c7mD');
    expect(payload.totalMs).toEqual(expect.any(Number));
    expect(payload.stages).toMatchObject({
      resolveShortUrlMs: expect.any(Number),
      fetchViewMs: expect.any(Number),
      playbackMs: expect.any(Number),
    });
  });

  it('expands dash quality map with bounded concurrency without losing candidate streams', async () => {
    const parserAny = parser as any;
    const deferredByQn = new Map<number, (value: any) => void>();
    let inflight = 0;
    let maxInflight = 0;

    jest
      .spyOn(parserAny, 'fetchPlayUrlData')
      .mockImplementation((_aid: number, _cid: number, params: Record<string, string | number>) => {
        const qn = Number(params.qn);
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);

        return new Promise((resolve) => {
          deferredByQn.set(qn, (value) => {
            inflight -= 1;
            resolve(value);
          });
        });
      });

    const candidateMap: Record<string, Array<{ url: string }>> = {};
    const task = parserAny.expandDashVideoMapByQuality(
      1,
      1,
      [120, 80, 64, 32],
      {},
      candidateMap,
    );

    await waitForNextTick();

    expect(maxInflight).toBeGreaterThan(1);
    expect(maxInflight).toBeLessThanOrEqual(3);

    deferredByQn.get(120)?.({
      dash: {
        video: [{ id: 30120, url: 'url-4k' }],
      },
    });
    deferredByQn.get(80)?.({
      dash: {
        video: [
          { id: 30080, url: 'url-1080-hevc' },
          { id: 30080, codecid: 7, url: 'url-1080-avc' },
        ],
      },
    });
    deferredByQn.get(64)?.({
      dash: {
        video: [{ id: 30064, url: 'url-720' }],
      },
    });

    await waitForNextTick();

    expect(deferredByQn.has(32)).toBe(true);

    deferredByQn.get(32)?.({
      dash: {
        video: [{ id: 30032, url: 'url-480' }],
      },
    });

    const result = await task;

    expect(result).toMatchObject({
      '4k': 'url-4k',
      '1080p': 'url-1080-hevc',
      '720p': 'url-720',
      '480p': 'url-480',
    });
    expect(candidateMap['1080p']?.map((item) => item.url)).toEqual(
      expect.arrayContaining(['url-1080-hevc', 'url-1080-avc']),
    );
  });

  it('builds merged quality map with bounded concurrency while preserving actual quality labels', async () => {
    const parserAny = parser as any;
    const deferredByQn = new Map<number, (value: any) => void>();
    let inflight = 0;
    let maxInflight = 0;

    jest
      .spyOn(parserAny, 'getProgressiveUrl')
      .mockImplementation((_aid: number, _cid: number, qn: number) => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);

        return new Promise((resolve) => {
          deferredByQn.set(qn, (value) => {
            inflight -= 1;
            resolve(value);
          });
        });
      });

    const task = parserAny.buildMergedQualityMap(
      1,
      1,
      [120, 80, 64, 32],
      ['4k', '1080p', '720p', '480p'],
    );

    await waitForNextTick();

    expect(maxInflight).toBeGreaterThan(1);
    expect(maxInflight).toBeLessThanOrEqual(3);

    deferredByQn.get(120)?.({ url: 'merged-4k', qualityQn: 120 });
    deferredByQn.get(80)?.({ url: 'merged-1080', qualityQn: 80 });
    deferredByQn.get(64)?.({ url: 'merged-720', qualityQn: 64 });

    await waitForNextTick();

    expect(deferredByQn.has(32)).toBe(true);

    deferredByQn.get(32)?.({ url: 'merged-480', qualityQn: 32 });

    const result = await task;

    expect(result).toEqual({
      '4k': 'merged-4k',
      '1080p': 'merged-1080',
      '720p': 'merged-720',
      '480p': 'merged-480',
    });
  });
});
