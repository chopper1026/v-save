import { DouyinAuthController } from './douyin-auth.controller';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';

describe('DouyinAuthController', () => {
  const douyinAuthService = {
    getStatus: jest.fn(),
    saveCookie: jest.fn(),
    clearSession: jest.fn(),
    startBridgeAuth: jest.fn(),
    getBridgeAuthStatus: jest.fn(),
    completeBridgeAuth: jest.fn(),
  };
  const adminUsersService = {
    recordAuditLog: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts bridge auth and writes an audit log', async () => {
    const controller = new DouyinAuthController(
      douyinAuthService as any,
      adminUsersService as any,
    );
    const req = {
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
      },
    } as any;

    douyinAuthService.startBridgeAuth.mockResolvedValue({
      authSessionId: 'bridge-1',
      uploadToken: 'upload-token',
      expiresAt: '2026-03-23T06:10:00.000Z',
      status: 'waiting_helper',
      loginUrl: 'https://www.douyin.com/',
    });

    const result = await controller.startBridgeAuth(req);

    expect(douyinAuthService.startBridgeAuth).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      adminEmail: 'admin@example.com',
    });
    expect(adminUsersService.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        action: 'DOUYIN_BRIDGE_AUTH_STARTED',
        module: 'AUTH',
        platform: 'DOUYIN',
      }),
    );
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        authSessionId: 'bridge-1',
        status: 'waiting_helper',
      }),
    });
  });

  it('returns bridge auth status', async () => {
    const controller = new DouyinAuthController(
      douyinAuthService as any,
      adminUsersService as any,
    );
    douyinAuthService.getBridgeAuthStatus.mockResolvedValue({
      authSessionId: 'bridge-1',
      status: 'waiting_helper',
      expiresAt: '2026-03-23T06:10:00.000Z',
      completedAt: null,
      lastError: null,
    });

    const result = await controller.getBridgeStatus('bridge-1');

    expect(douyinAuthService.getBridgeAuthStatus).toHaveBeenCalledWith('bridge-1');
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        authSessionId: 'bridge-1',
        status: 'waiting_helper',
      }),
    });
  });

  it('completes bridge auth and writes a confirmation audit log', async () => {
    const controller = new DouyinAuthController(
      douyinAuthService as any,
      adminUsersService as any,
    );
    const req = {} as any;
    douyinAuthService.completeBridgeAuth.mockResolvedValue({
      authSessionId: 'bridge-1',
      status: 'confirmed',
      completedAt: '2026-03-23T06:02:00.000Z',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
    });

    const result = await controller.completeBridgeAuth(req, {
      authSessionId: 'bridge-1',
      uploadToken: 'upload-token',
      cookieHeader: 'sessionid=bridge-cookie; ttwid=helper;',
    });

    expect(douyinAuthService.completeBridgeAuth).toHaveBeenCalledWith({
      authSessionId: 'bridge-1',
      uploadToken: 'upload-token',
      cookieHeader: 'sessionid=bridge-cookie; ttwid=helper;',
    });
    expect(adminUsersService.recordAuditLog).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        authSessionId: 'bridge-1',
        status: 'confirmed',
      }),
    });
  });

  it('marks only bridge complete as public', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        DouyinAuthController.prototype.completeBridgeAuth,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        DouyinAuthController.prototype.startBridgeAuth,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        DouyinAuthController.prototype.getBridgeStatus,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        DouyinAuthController.prototype.getStatus,
      ),
    ).toBeUndefined();
  });

  it('does not expose legacy qrcode endpoints on the controller', () => {
    expect(
      (DouyinAuthController.prototype as unknown as Record<string, unknown>).generateQrCode,
    ).toBeUndefined();
    expect(
      (DouyinAuthController.prototype as unknown as Record<string, unknown>).pollQrCode,
    ).toBeUndefined();
  });
});
