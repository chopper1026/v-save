import { AdminDownloadModesController } from './admin-download-modes.controller';
import {
  DownloadClientType,
  DownloadModePlatform,
  DownloadModeSource,
  DownloadPolicyMode,
} from '../download-mode/download-mode.types';

describe('AdminDownloadModesController', () => {
  const downloadModeService = {
    getSchema: jest.fn(),
    getConfigs: jest.fn(),
    updateModeConfig: jest.fn(),
  };
  const adminUsersService = {
    recordAuditLog: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates mode config and writes audit log', async () => {
    const controller = new AdminDownloadModesController(
      downloadModeService as any,
      adminUsersService as any,
    );

    downloadModeService.updateModeConfig.mockResolvedValue({
      platform: DownloadModePlatform.DOUYIN,
      clientType: DownloadClientType.WEB,
      mode: DownloadPolicyMode.SPEED_FIRST,
      source: DownloadModeSource.DATABASE,
      editable: true,
      updatedAt: '2026-03-19T00:00:00.000Z',
      updatedByEmail: 'admin@example.com',
    });

    const req = {
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        role: 'SUPER_ADMIN',
      },
    } as any;

    const result = await controller.updateConfig(
      req,
      DownloadModePlatform.DOUYIN,
      DownloadClientType.WEB,
      { mode: DownloadPolicyMode.SPEED_FIRST },
    );

    expect(downloadModeService.updateModeConfig).toHaveBeenCalledWith({
      platform: DownloadModePlatform.DOUYIN,
      clientType: DownloadClientType.WEB,
      mode: DownloadPolicyMode.SPEED_FIRST,
      updatedByUserId: 'admin-1',
      updatedByEmail: 'admin@example.com',
    });
    expect(adminUsersService.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        action: 'UPDATE_DOWNLOAD_MODE',
        module: 'DOWNLOAD_POLICY',
        platform: 'DOUYIN',
      }),
    );
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        mode: DownloadPolicyMode.SPEED_FIRST,
      }),
    });
  });
});
