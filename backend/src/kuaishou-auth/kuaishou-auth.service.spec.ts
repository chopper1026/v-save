import axios from 'axios';

type MockRepository = {
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  delete: jest.Mock;
};

const createRepository = (): MockRepository => ({
  findOne: jest.fn(),
  save: jest.fn(async (payload) => payload),
  create: jest.fn((payload) => payload),
  delete: jest.fn(async () => undefined),
});

describe('KuaishouAuthService', () => {
  let repository: MockRepository;
  let KuaishouAuthService: any;

  beforeEach(() => {
    repository = createRepository();
    KuaishouAuthService = null;

    try {
      ({ KuaishouAuthService } = require('./kuaishou-auth.service'));
    } catch (_error) {
      KuaishouAuthService = null;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.KUAISHOU_COOKIE;
  });

  it('generates kuaishou qrcode payload with displayable image data', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        result: 1,
        qrLoginToken: 'qr-token-1',
        qrLoginSignature: 'qr-signature-1',
        qrUrl: 'http://qr.kuaishou.com/l/abc123',
        imageData: 'base64-png-payload',
        expireTime: 1774957744250,
      },
    } as any);

    const result = await service.generateQrCode();

    expect(result).toEqual({
      qrLoginToken: 'qr-token-1',
      qrLoginSignature: 'qr-signature-1',
      qrUrl: 'http://qr.kuaishou.com/l/abc123',
      imageDataUrl: 'data:image/png;base64,base64-png-payload',
      expireAt: new Date(1774957744250).toISOString(),
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://id.kuaishou.com/rest/c/infra/ks/qr/start',
      expect.any(URLSearchParams),
      expect.objectContaining({
        timeout: 15000,
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    );

    const requestBody = (axios.post as jest.Mock).mock.calls[0]?.[1];
    expect(requestBody).toBeInstanceOf(URLSearchParams);
    expect(requestBody.toString()).toContain('sid=kuaishou.server.webday7');
    expect(requestBody.toString()).toContain('channelType=UNKNOWN');
    expect(requestBody.toString()).toContain('isWebSig4=true');
  });

  it('treats kuaishou qrcode long-poll timeout as pending', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post').mockRejectedValueOnce({
      code: 'ECONNABORTED',
      message: 'timeout of 25000ms exceeded',
    });

    const result = await service.pollQrLogin('qr-token-1', 'qr-signature-1');

    expect(result).toEqual({
      status: 'pending',
      message: '等待扫码确认',
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('persists kuaishou cookie when qrcode login is confirmed', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        result: 1,
        status: 'CONFIRMED',
        msg: '登录成功',
      },
      headers: {
        'set-cookie': [
          'did=web_123; Path=/',
          'clientid=3; Path=/',
          'kpf=PC_WEB; Path=/',
          'kpn=KUAISHOU_VISION; Path=/',
          'kuaishou.server.web_st=secure-token; Path=/; HttpOnly',
          'userId=218734; Path=/',
        ],
      },
    } as any);

    const result = await service.pollQrLogin('qr-token-1', 'qr-signature-1');

    expect(result).toEqual({
      status: 'confirmed',
      message: '登录成功，快手 Cookie 已保存',
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://id.kuaishou.com/rest/c/infra/ks/qr/scanResult',
      expect.any(URLSearchParams),
      expect.objectContaining({
        timeout: 25000,
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        validateStatus: expect.any(Function),
      }),
    );

    const requestBody = (axios.post as jest.Mock).mock.calls[0]?.[1];
    expect(requestBody).toBeInstanceOf(URLSearchParams);
    expect(requestBody.toString()).toContain('qrLoginToken=qr-token-1');
    expect(requestBody.toString()).toContain('qrLoginSignature=qr-signature-1');
    expect(requestBody.toString()).toContain('channelType=UNKNOWN');
    expect(requestBody.toString()).toContain('isWebSig4=true');

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save.mock.calls[0][0]).toMatchObject({
      platform: 'kuaishou',
      cookie: expect.stringContaining('kuaishou.server.web_st=secure-token'),
      lastError: null,
    });
  });

  it('treats numeric scanResult success with login cookies as confirmed', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        result: 1,
        error_msg: '登录成功',
      },
      headers: {
        'set-cookie': [
          'did=web_123; Path=/',
          'clientid=3; Path=/',
          'kpf=PC_WEB; Path=/',
          'kpn=KUAISHOU_VISION; Path=/',
          'kuaishou.server.web_st=secure-token; Path=/; HttpOnly',
          'userId=218734; Path=/',
        ],
      },
    } as any);

    const result = await service.pollQrLogin('qr-token-1', 'qr-signature-1');

    expect(result).toEqual({
      status: 'confirmed',
      message: '登录成功，快手 Cookie 已保存',
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('treats numeric expired scanResult as expired', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        result: 707,
        error_msg: '登录二维码已过期',
      },
      headers: {},
    } as any);

    const result = await service.pollQrLogin('qr-token-1', 'qr-signature-1');

    expect(result).toEqual({
      status: 'expired',
      message: '二维码已过期，请重新生成',
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('follows callback url to persist kuaishou cookie when scanResult omits set-cookie', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        result: 1,
        message: '登录成功',
        callback: '/pass/kuaishou/login/qr/callback?ticket=abc123',
      },
      headers: {},
    } as any);
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 302,
      headers: {
        'set-cookie': [
          'did=web_123; Path=/',
          'clientid=3; Path=/',
          'kpf=PC_WEB; Path=/',
          'kpn=KUAISHOU_VISION; Path=/',
          'kuaishou.server.web_st=secure-token; Path=/; HttpOnly',
          'userId=218734; Path=/',
        ],
        location: 'https://www.kuaishou.com/new-reco',
      },
    } as any);

    const result = await service.pollQrLogin('qr-token-1', 'qr-signature-1');

    expect(result).toEqual({
      status: 'confirmed',
      message: '登录成功，快手 Cookie 已保存',
    });
    expect(axios.get).toHaveBeenCalledWith(
      'https://www.kuaishou.com/pass/kuaishou/login/qr/callback?ticket=abc123',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
        maxRedirects: 0,
        validateStatus: expect.any(Function),
      }),
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('treats callback success as confirmed even when message mentions qrcode expiry', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        result: 1,
        message: '登录成功，二维码已过期',
        callback: '/pass/kuaishou/login/qr/callback?ticket=abc123',
      },
      headers: {},
    } as any);
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 302,
      headers: {
        'set-cookie': [
          'did=web_123; Path=/',
          'clientid=3; Path=/',
          'kpf=PC_WEB; Path=/',
          'kpn=KUAISHOU_VISION; Path=/',
          'kuaishou.server.web_st=secure-token; Path=/; HttpOnly',
          'userId=218734; Path=/',
        ],
      },
    } as any);

    const result = await service.pollQrLogin('qr-token-1', 'qr-signature-1');

    expect(result).toEqual({
      status: 'confirmed',
      message: '登录成功，快手 Cookie 已保存',
    });
  });

  it('continues with acceptResult and callback after scanResult returns kuaishou user info', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({
        data: {
          result: 1,
          user: {
            user_id: 4311146547,
            user_name: '常暗',
            eid: '3xptzwhh99bfuhu',
          },
        },
        headers: {},
      } as any)
      .mockResolvedValueOnce({
        data: {
          result: 1,
          qrToken: 'accepted-qr-token',
        },
        headers: {},
      } as any)
      .mockResolvedValueOnce({
        data: {
          result: 1,
        },
        headers: {
          'set-cookie': [
            'did=web_123; Path=/',
            'clientid=3; Path=/',
            'kpf=PC_WEB; Path=/',
            'kpn=KUAISHOU_VISION; Path=/',
            'kuaishou.server.web_st=secure-token; Path=/; HttpOnly',
            'userId=218734; Path=/',
          ],
        },
      } as any);

    const result = await service.pollQrLogin('qr-token-1', 'qr-signature-1');

    expect(result).toEqual({
      status: 'confirmed',
      message: '登录成功，快手 Cookie 已保存',
    });

    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      'https://id.kuaishou.com/rest/c/infra/ks/qr/scanResult',
      expect.any(URLSearchParams),
      expect.objectContaining({
        timeout: 25000,
      }),
    );
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://id.kuaishou.com/rest/c/infra/ks/qr/acceptResult',
      expect.any(URLSearchParams),
      expect.objectContaining({
        timeout: 25000,
      }),
    );
    expect(axios.post).toHaveBeenNthCalledWith(
      3,
      'https://id.kuaishou.com/pass/kuaishou/login/qr/callback',
      expect.any(URLSearchParams),
      expect.objectContaining({
        timeout: 15000,
      }),
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('persists synthesized cookie when qr callback returns token payload without set-cookie', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    const service = new KuaishouAuthService(repository as any);
    jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({
        data: {
          result: 1,
          user: {
            user_id: 4311146547,
            user_name: '常暗',
            eid: '3xptzwhh99bfuhu',
          },
        },
        headers: {},
      } as any)
      .mockResolvedValueOnce({
        data: {
          result: 1,
          qrToken: 'accepted-qr-token',
        },
        headers: {},
      } as any)
      .mockResolvedValueOnce({
        data: {
          result: 1,
          'kuaishou.server.webday7.at': 'auth-token-from-callback',
          'kuaishou.server.webday7_st': 'service-token-from-callback',
          passToken: 'pass-token-from-callback',
          ssecurity: 'ssecurity-from-callback',
          userId: 4311146547,
          sid: 'kuaishou.server.webday7',
        },
        headers: {},
      } as any);

    const result = await service.pollQrLogin('qr-token-1', 'qr-signature-1');

    expect(result).toEqual({
      status: 'confirmed',
      message: '登录成功，快手 Cookie 已保存',
    });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save.mock.calls[0][0]).toMatchObject({
      platform: 'kuaishou',
      lastError: null,
    });
    expect(repository.save.mock.calls[0][0].cookie).toEqual(
      expect.stringContaining('clientid=3'),
    );
    expect(repository.save.mock.calls[0][0].cookie).toEqual(
      expect.stringContaining('kpf=PC_WEB'),
    );
    expect(repository.save.mock.calls[0][0].cookie).toEqual(
      expect.stringContaining('kpn=KUAISHOU_VISION'),
    );
    expect(repository.save.mock.calls[0][0].cookie).toEqual(
      expect.stringContaining('userId=4311146547'),
    );
    expect(repository.save.mock.calls[0][0].cookie).toEqual(
      expect.stringContaining('kuaishou.server.web_st=service-token-from-callback'),
    );
    expect(repository.save.mock.calls[0][0].cookie).toEqual(
      expect.stringContaining('kuaishou.server.web_at=auth-token-from-callback'),
    );
    expect(repository.save.mock.calls[0][0].cookie).toEqual(
      expect.stringContaining('passToken=pass-token-from-callback'),
    );
  });

  it('reads kuaishou auth status from environment when database is empty', async () => {
    expect(KuaishouAuthService).toBeTruthy();
    if (!KuaishouAuthService) {
      return;
    }

    process.env.KUAISHOU_COOKIE = [
      'did=web_123',
      'clientid=3',
      'kpf=PC_WEB',
      'kpn=KUAISHOU_VISION',
      'kuaishou.server.web_st=secure-token',
      'userId=218734',
    ].join('; ');
    repository.findOne.mockResolvedValue(null);

    const service = new KuaishouAuthService(repository as any);
    const status = await service.getStatus();

    expect(status).toMatchObject({
      hasCookie: true,
      source: 'environment',
      userId: '218734',
      lastError: null,
    });
  });
});
