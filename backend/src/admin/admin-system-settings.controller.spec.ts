import { AdminSystemSettingsController } from './admin-system-settings.controller';

describe('AdminSystemSettingsController', () => {
  const systemSettingsService = {
    getAdminSettings: jest.fn(),
    updateSettings: jest.fn(),
  };
  const adminUsersService = {
    recordAuditLog: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns current system settings snapshot', async () => {
    systemSettingsService.getAdminSettings.mockResolvedValue({
      registrationEnabled: false,
    });

    const controller = new AdminSystemSettingsController(
      systemSettingsService as any,
      adminUsersService as any,
    );

    await expect(controller.getSettings()).resolves.toEqual({
      success: true,
      data: {
        registrationEnabled: false,
      },
    });
  });

  it('updates registration setting and writes audit log', async () => {
    systemSettingsService.getAdminSettings.mockResolvedValue({
      registrationEnabled: false,
    });
    systemSettingsService.updateSettings.mockResolvedValue({
      registrationEnabled: true,
    });

    const controller = new AdminSystemSettingsController(
      systemSettingsService as any,
      adminUsersService as any,
    );
    const req = {
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        role: 'SUPER_ADMIN',
      },
    } as any;

    const result = await controller.updateSettings(req, {
      registrationEnabled: true,
      reason: '开放人工注册',
    });

    expect(systemSettingsService.updateSettings).toHaveBeenCalledWith({
      registrationEnabled: true,
    });
    expect(adminUsersService.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        action: 'UPDATE_SYSTEM_SETTING',
        module: 'SYSTEM',
        targetType: 'SYSTEM',
        beforeState: {
          registrationEnabled: false,
        },
        afterState: {
          registrationEnabled: true,
        },
        reason: '开放人工注册',
      }),
    );
    expect(result).toEqual({
      success: true,
      data: {
        registrationEnabled: true,
      },
    });
  });
});
