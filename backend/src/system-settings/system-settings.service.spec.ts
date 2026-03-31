import { SystemSettingsService } from './system-settings.service';

describe('SystemSettingsService', () => {
  const createRepositoryMock = () => ({
    find: jest.fn(),
    create: jest.fn((payload) => payload),
    save: jest.fn(async (payload) => payload),
  });

  it('returns registration disabled when no persisted setting exists', async () => {
    const repository = createRepositoryMock();
    repository.find.mockResolvedValue([]);

    const service = new SystemSettingsService(repository as any);

    await expect(service.getPublicSettings()).resolves.toEqual({
      registrationEnabled: false,
    });
  });

  it('updates registrationEnabled and persists normalized values', async () => {
    const repository = createRepositoryMock();
    repository.find.mockResolvedValue([
      {
        key: 'registration_enabled',
        value: 'false',
      },
    ]);

    const service = new SystemSettingsService(repository as any);

    await expect(
      service.updateSettings({
        registrationEnabled: true,
      }),
    ).resolves.toEqual({
      registrationEnabled: true,
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'registration_enabled',
        value: 'true',
      }),
    );
  });
});
