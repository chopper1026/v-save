import axios from 'axios';
import { ProxyController } from './proxy.controller';

jest.mock('axios');

const mockedAxios = axios as unknown as jest.Mock;

const createMockResponse = () => {
  const res: any = {
    statusCode: 200,
    body: null,
    headersSent: false,
    setHeader: jest.fn(),
    status: jest.fn(function status(code: number) {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn(function json(payload: unknown) {
      res.body = payload;
      return res;
    }),
  };

  return res;
};

describe('ProxyController', () => {
  const bilibiliAuthService = {
    getCookieHeader: jest.fn().mockResolvedValue(''),
  };
  const douyinAuthService = {
    getCookieHeader: jest.fn().mockResolvedValue('sessionid=abc; ttwid=xyz'),
  };

  let controller: ProxyController;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    controller = new ProxyController(
      bilibiliAuthService as any,
      douyinAuthService as any,
    );
    mockedAxios.mockReset();
    bilibiliAuthService.getCookieHeader.mockClear();
    douyinAuthService.getCookieHeader.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('retries douyin /play/ url with /playwm/ when upstream returns 403', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios
      .mockRejectedValueOnce({
        message: 'Request failed with status code 403',
        response: { status: 403 },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'video/mp4' },
        data: stream,
      });

    const req: any = { headers: {} };
    const res = createMockResponse();
    const playUrl =
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=720p&line=0';

    await controller.proxyFetch(encodeURIComponent(playUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(2);
    expect(mockedAxios.mock.calls[1][0].url).toContain('/aweme/v1/playwm/');
    expect(stream.pipe).toHaveBeenCalledWith(res);
    expect(res.statusCode).toBe(200);
  });

  it('retries douyin /playwm/ url with /play/ when upstream returns 403', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios
      .mockRejectedValueOnce({
        message: 'Request failed with status code 403',
        response: { status: 403 },
      })
      .mockResolvedValueOnce({
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-100/1000',
        },
        data: stream,
      });

    const req: any = { headers: { range: 'bytes=0-100' } };
    const res = createMockResponse();
    const playwmUrl =
      'https://aweme.snssdk.com/aweme/v1/playwm/?video_id=test123&ratio=720p&line=0';

    await controller.proxyFetch(encodeURIComponent(playwmUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(2);
    expect(mockedAxios.mock.calls[1][0].url).toContain('/aweme/v1/play/');
    expect(stream.pipe).toHaveBeenCalledWith(res);
    expect(res.statusCode).toBe(206);
  });

  it('does not retry douyin /play/ url to /playwm/ when watermark fallback is disabled', async () => {
    mockedAxios.mockRejectedValueOnce({
      message: 'Request failed with status code 403',
      response: { status: 403 },
    });

    const req: any = { headers: {}, query: { allowWatermarkFallback: '0' } };
    const res = createMockResponse();
    const playUrl =
      'https://aweme.snssdk.com/aweme/v1/play/?video_id=test123&ratio=1080p&line=4';

    await controller.proxyFetch(encodeURIComponent(playUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'DOUYIN_WATERMARK_FALLBACK_REQUIRED',
        retryable: true,
      }),
    );
  });

  it('does not retry non-douyin urls and returns 502', async () => {
    mockedAxios.mockRejectedValueOnce({
      message: 'Request failed with status code 403',
      response: { status: 403 },
    });

    const req: any = { headers: {} };
    const res = createMockResponse();

    await controller.proxyFetch(
      encodeURIComponent('https://example.com/video.mp4'),
      'video',
      req,
      res,
    );

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(502);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns non-empty upstream error detail when axios error message is empty', async () => {
    mockedAxios.mockRejectedValueOnce({
      message: '',
      code: 'ECONNRESET',
    });

    const req: any = { headers: {} };
    const res = createMockResponse();

    await controller.proxyFetch(
      encodeURIComponent('https://example.com/video.mp4'),
      'video',
      req,
      res,
    );

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(502);
    expect(res.body).toBeDefined();
    expect(res.body.error).toMatch(/^Failed to fetch:\s+/);
    expect(res.body.error).not.toBe('Failed to fetch: ');
  });

  it('adds douyin referer and cookie for douyin cover cdn image urls', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      data: stream,
    });

    const req: any = { headers: {} };
    const res = createMockResponse();
    const coverUrl =
      'https://p3-sign.douyinpic.com/tos-cn-p-0015/oQ0QeAaA~tplv-dy-resize:2048:2048.jpeg';

    await controller.proxyFetch(encodeURIComponent(coverUrl), 'image', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const axiosRequest = mockedAxios.mock.calls[0][0];
    expect(axiosRequest.headers.Referer).toBe('https://www.douyin.com');
    expect(axiosRequest.headers.Cookie).toContain('sessionid=abc');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('adds douyin referer and cookie for douyinvod direct cdn video urls', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios.mockResolvedValueOnce({
      status: 206,
      headers: { 'content-type': 'video/mp4' },
      data: stream,
    });

    const req: any = { headers: { range: 'bytes=0-1023' } };
    const res = createMockResponse();
    const douyinVodUrl =
      'https://v26-web.douyinvod.com/088a4a6739baff6fde253f77af165888/69bfa50c/video/tos/cn/tos-cn-ve-15/o49AJEkDgTCB0nPFfop9AgAwQR9SBvIevLktsN/?a=6383&mime_type=video_mp4';

    await controller.proxyFetch(encodeURIComponent(douyinVodUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const axiosRequest = mockedAxios.mock.calls[0][0];
    expect(axiosRequest.headers.Referer).toBe('https://www.douyin.com');
    expect(axiosRequest.headers.Origin).toBe('https://www.douyin.com');
    expect(axiosRequest.headers.Cookie).toContain('sessionid=abc');
    expect(axiosRequest.headers.Range).toBe('bytes=0-1023');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('adds kuaishou referer for kuaishou cdn video urls', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      data: stream,
    });

    const req: any = { headers: {} };
    const res = createMockResponse();
    const kuaishouCdnUrl =
      'https://v23-3.kwaicdn.com/upic/2026/03/10/19/sample.mp4?pkey=test';

    await controller.proxyFetch(encodeURIComponent(kuaishouCdnUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const axiosRequest = mockedAxios.mock.calls[0][0];
    expect(axiosRequest.headers.Referer).toBe('https://www.kuaishou.com');
    expect(axiosRequest.headers.Origin).toBe('https://www.kuaishou.com');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('adds kuaishou referer for ndcimgs mp4 urls', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios.mockResolvedValueOnce({
      status: 206,
      headers: { 'content-type': 'video/mp4' },
      data: stream,
    });

    const req: any = { headers: { range: 'bytes=0-65535' } };
    const res = createMockResponse();
    const ndcimgsUrl =
      'https://k0u1by80yd4y8ez.djvod.ndcimgs.com/upic/2026/02/25/14/sample.mp4?pkey=test';

    await controller.proxyFetch(encodeURIComponent(ndcimgsUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const axiosRequest = mockedAxios.mock.calls[0][0];
    expect(axiosRequest.headers.Referer).toBe('https://www.kuaishou.com');
    expect(axiosRequest.headers.Origin).toBe('https://www.kuaishou.com');
    expect(axiosRequest.headers.Range).toBe('bytes=0-65535');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('adds xiaohongshu referer and origin for xhscdn video urls', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      data: stream,
    });

    const req: any = { headers: {} };
    const res = createMockResponse();
    const xhsCdnUrl =
      'https://sns-video-hw.xhscdn.com/stream/110/258/01e6f6abf9a0.mp4?sign=abc';

    await controller.proxyFetch(encodeURIComponent(xhsCdnUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const axiosRequest = mockedAxios.mock.calls[0][0];
    expect(axiosRequest.headers.Referer).toBe('https://www.xiaohongshu.com');
    expect(axiosRequest.headers.Origin).toBe('https://www.xiaohongshu.com');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('retries xiaohongshu media url with backup host when upstream returns 403', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios
      .mockRejectedValueOnce({
        message: 'Request failed with status code 403',
        response: { status: 403 },
      })
      .mockResolvedValueOnce({
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/3702386' },
        data: stream,
      });

    const req: any = { headers: { range: 'bytes=0-1' } };
    const res = createMockResponse();
    const sourceUrl =
      'https://sns-video-hs.xhscdn.com/stream/1/110/258/01e9b4e9d0c5c6d2010370019ceab1f19e_258.mp4';

    await controller.proxyFetch(encodeURIComponent(sourceUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(2);
    expect(mockedAxios.mock.calls[1][0].url).toContain('sns-bak-v1.xhscdn.com');
    expect(stream.pipe).toHaveBeenCalledWith(res);
    expect(res.statusCode).toBe(206);
  });

  it('retries xiaohongshu image with quality variant instead of video backup host', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios
      .mockRejectedValueOnce({
        message: 'Request failed with status code 403',
        response: { status: 403 },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        data: stream,
      });

    const req: any = { headers: {} };
    const res = createMockResponse();
    const sourceUrl =
      'https://sns-webpic-qc.xhscdn.com/202603151754/be66246d24b67823642b7adac72e1b57/1040g2sg31tdmc8krm8e05pvjdqqinpcdm5u2q60!nd_dft_wlteh_jpg_3';

    await controller.proxyFetch(encodeURIComponent(sourceUrl), 'image', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(2);
    const fallbackUrl = mockedAxios.mock.calls[1][0].url as string;
    expect(fallbackUrl).toContain('!nd_prv_wlteh_jpg_3');
    expect(fallbackUrl).not.toContain('sns-bak-v1.xhscdn.com');
    expect(stream.pipe).toHaveBeenCalledWith(res);
    expect(res.statusCode).toBe(200);
  });

  it('keeps encoded douyin signature characters to avoid signed url mismatch', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/webp' },
      data: stream,
    });

    const req: any = { headers: {} };
    const res = createMockResponse();
    const signedCoverUrl =
      'https://p26-sign.douyinpic.com/tos-cn-i-dy/cover.webp?x-signature=abc%2B123%3D%3D&x-expires=1774749600';

    // Express query parser already decodes once before hitting controller.
    // The controller must not decode again, otherwise `%2B` becomes `+`.
    await controller.proxyFetch(signedCoverUrl, 'image', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const axiosRequest = mockedAxios.mock.calls[0][0];
    expect(axiosRequest.url).toContain('x-signature=abc%2B123%3D%3D');
    expect(axiosRequest.url).not.toContain('x-signature=abc+123==');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('uses connect-timeout strategy and removes hard axios timeout for long stream downloads', async () => {
    const stream = {
      pipe: jest.fn(),
      setTimeout: jest.fn(),
      once: jest.fn(),
    };
    mockedAxios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      data: stream,
    });

    const req: any = { headers: {} };
    const res = createMockResponse();

    await controller.proxyFetch(
      encodeURIComponent('https://example.com/large-video.mp4'),
      'video',
      req,
      res,
    );

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const axiosRequest = mockedAxios.mock.calls[0][0];
    expect(axiosRequest.timeout).toBe(0);
    expect(axiosRequest.signal).toBeDefined();
    expect(stream.setTimeout).toHaveBeenCalledWith(300000);
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('normalizes octet-stream mp4 segment responses to video/mp4 for video preview stability', async () => {
    const stream = { pipe: jest.fn() };
    mockedAxios.mockResolvedValueOnce({
      status: 206,
      headers: {
        'content-type': 'application/octet-stream',
        'content-range': 'bytes 0-2047/770483',
      },
      data: stream,
    });

    const req: any = { headers: { range: 'bytes=0-2047' } };
    const res = createMockResponse();
    const bilibiliDashUrl =
      'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/sample-720-avc.m4s?upsig=test';

    await controller.proxyFetch(encodeURIComponent(bilibiliDashUrl), 'video', req, res);

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const contentTypeCalls = (res.setHeader as jest.Mock).mock.calls.filter(
      ([name]) => name === 'Content-Type',
    );
    expect(contentTypeCalls.at(-1)).toEqual(['Content-Type', 'video/mp4']);
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });
});
