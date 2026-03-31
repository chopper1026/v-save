import { SystemSettingsController } from './system-settings.controller';

describe('SystemSettingsController', () => {
  it('returns public registration settings snapshot', async () => {
    const systemSettingsService = {
      getPublicSettings: jest.fn().mockResolvedValue({
        registrationEnabled: false,
      }),
    };
    const controller = new SystemSettingsController(systemSettingsService as any);

    await expect(controller.getPublicSettings()).resolves.toEqual({
      success: true,
      data: {
        registrationEnabled: false,
      },
    });
  });
});
