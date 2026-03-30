import axios from 'axios';
import { BilibiliAuthService } from './bilibili-auth.service';

type MockRepository = {
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
};

const createRepository = (): MockRepository => {
  const repo: MockRepository = {
    findOne: jest.fn(),
    save: jest.fn(async (payload) => payload),
    create: jest.fn((payload) => payload),
  };
  return repo;
};

describe('BilibiliAuthService', () => {
  let service: BilibiliAuthService;
  let repository: MockRepository;

  beforeEach(() => {
    repository = createRepository();
    service = new BilibiliAuthService(repository as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns pending when qrcode login is not confirmed', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          code: 86101,
          message: '未扫码',
        },
      },
    } as any);

    const result = await service.pollQrLogin('test-qrcode-key');

    expect(result.status).toBe('pending');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('persists cookie and refresh token when qrcode login is confirmed', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          code: 0,
          message: '0',
          refresh_token: 'refresh-token-from-poll',
        },
      },
      headers: {
        'set-cookie': [
          'SESSDATA=session-a; Path=/; HttpOnly',
          'bili_jct=csrf-a; Path=/',
          'DedeUserID=10086; Path=/',
          'DedeUserID__ckMd5=hash-a; Path=/',
        ],
      },
    } as any);

    const result = await service.pollQrLogin('test-qrcode-key');

    expect(result.status).toBe('confirmed');
    expect(repository.save).toHaveBeenCalledTimes(1);
    const payload = repository.save.mock.calls[0][0];
    expect(payload.cookie).toContain('SESSDATA=session-a');
    expect(payload.cookie).toContain('bili_jct=csrf-a');
    expect(payload.cookie).toContain('DedeUserID=10086');
    expect(payload.refreshToken).toBe('refresh-token-from-poll');
  });

  it('refreshes cookie and token when bilibili marks cookie as refreshable', async () => {
    repository.findOne.mockResolvedValue({
      platform: 'bilibili',
      cookie:
        'SESSDATA=old-session; bili_jct=old-csrf; DedeUserID=10086; DedeUserID__ckMd5=old-md5',
      refreshToken: 'old-refresh-token',
    });

    jest.spyOn(axios, 'get')
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            refresh: true,
            timestamp: 1710000000000,
          },
        },
      } as any)
      .mockResolvedValueOnce({
        data: '<html><body><div id="1-name">refresh-csrf-from-correspond</div></body></html>',
      } as any);

    jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            refresh_token: 'new-refresh-token',
          },
        },
        headers: {
          'set-cookie': [
            'SESSDATA=new-session; Path=/; HttpOnly',
            'bili_jct=new-csrf; Path=/',
            'DedeUserID=10086; Path=/',
            'DedeUserID__ckMd5=new-md5; Path=/',
          ],
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          code: 0,
          message: '0',
        },
      } as any);

    const result = await service.refreshCookieIfNeeded(true);

    expect(result.refreshed).toBe(true);
    expect(repository.save).toHaveBeenCalledTimes(1);
    const payload = repository.save.mock.calls[0][0];
    expect(payload.cookie).toContain('SESSDATA=new-session');
    expect(payload.cookie).toContain('bili_jct=new-csrf');
    expect(payload.refreshToken).toBe('new-refresh-token');
  });

  it('does not force refresh when cookie info reports refresh is not needed', async () => {
    repository.findOne.mockResolvedValue({
      platform: 'bilibili',
      cookie:
        'SESSDATA=stable-session; bili_jct=stable-csrf; DedeUserID=10086; DedeUserID__ckMd5=stable-md5',
      refreshToken: 'stable-refresh-token',
    });

    const axiosGetSpy = jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          refresh: false,
          timestamp: 1710000000000,
        },
      },
    } as any);

    const result = await service.refreshCookieIfNeeded(true);

    expect(result).toEqual({
      refreshed: false,
      needed: false,
      message: '当前 Cookie 无需刷新',
    });
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('returns graceful message when correspond endpoint returns 404', async () => {
    repository.findOne.mockResolvedValue({
      platform: 'bilibili',
      cookie:
        'SESSDATA=old-session; bili_jct=old-csrf; DedeUserID=10086; DedeUserID__ckMd5=old-md5',
      refreshToken: 'old-refresh-token',
    });

    jest
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            refresh: true,
            timestamp: 1710000000000,
          },
        },
      } as any)
      .mockRejectedValueOnce({
        response: { status: 404 },
        message: 'Request failed with status code 404',
      } as any);

    const result = await service.refreshCookieIfNeeded(false);

    expect(result.refreshed).toBe(false);
    expect(result.needed).toBe(true);
    expect(result.message).toContain('刷新校验接口');
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
