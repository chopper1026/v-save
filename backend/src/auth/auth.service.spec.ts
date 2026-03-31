import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  it('omits legacy access-level fields from login response and jwt payload', async () => {
    const baseUser = {
      id: 'user-1',
      email: 'user@example.com',
      password: 'hashed-password',
      nickname: '用户',
      role: 'USER' as const,
      accountStatus: 'ACTIVE' as const,
      avatar: null,
      phone: null,
      downloadCount: 3,
    };
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue(baseUser),
      isUserDisabled: jest.fn().mockReturnValue(false),
      validatePassword: jest.fn().mockResolvedValue(true),
      syncRoleByPolicy: jest.fn().mockImplementation(async (user) => user),
    };
    const jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
    };

    const service = new AuthService(usersService as any, jwtService as any);
    const result = await service.login({
      email: 'user@example.com',
      password: 'secret',
    });

    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'USER',
      accountStatus: 'ACTIVE',
    });
    expect(result.user).not.toHaveProperty('membershipLevel');
    expect(result.user).not.toHaveProperty('vipExpireDate');
  });

  it('rejects registration when public registration is disabled', async () => {
    const usersService = {
      create: jest.fn(),
      syncRoleByPolicy: jest.fn(),
    };
    const jwtService = {
      sign: jest.fn(),
    };
    const service = new AuthService(usersService as any, jwtService as any);
    (service as any).systemSettingsService = {
      getPublicSettings: jest.fn().mockResolvedValue({
        registrationEnabled: false,
      }),
    };

    await expect(
      service.register({
        email: 'user@example.com',
        password: 'secret123',
        nickname: '用户',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.create).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
  });
});
