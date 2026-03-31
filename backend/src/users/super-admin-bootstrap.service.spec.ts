import { SuperAdminBootstrapService } from './super-admin-bootstrap.service';

describe('SuperAdminBootstrapService', () => {
  it('bootstraps default super admin from environment on application bootstrap', async () => {
    const usersService = {
      ensureBootstrapSuperAdmin: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          SUPER_ADMIN_BOOTSTRAP_EMAIL: 'admin@gmail.com',
          SUPER_ADMIN_BOOTSTRAP_PASSWORD: 'admin123',
          SUPER_ADMIN_BOOTSTRAP_NICKNAME: '系统管理员',
        };
        return values[key] ?? defaultValue;
      }),
    };

    const service = new SuperAdminBootstrapService(
      configService as any,
      usersService as any,
    );

    await service.onApplicationBootstrap();

    expect(usersService.ensureBootstrapSuperAdmin).toHaveBeenCalledWith({
      email: 'admin@gmail.com',
      password: 'admin123',
      nickname: '系统管理员',
    });
  });

  it('skips bootstrap when email or password is empty', async () => {
    const usersService = {
      ensureBootstrapSuperAdmin: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          SUPER_ADMIN_BOOTSTRAP_EMAIL: 'admin@gmail.com',
          SUPER_ADMIN_BOOTSTRAP_PASSWORD: '',
          SUPER_ADMIN_BOOTSTRAP_NICKNAME: '系统管理员',
        };
        return values[key] ?? defaultValue;
      }),
    };

    const service = new SuperAdminBootstrapService(
      configService as any,
      usersService as any,
    );

    await service.onApplicationBootstrap();

    expect(usersService.ensureBootstrapSuperAdmin).not.toHaveBeenCalled();
  });
});
