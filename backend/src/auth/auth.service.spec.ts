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
});
