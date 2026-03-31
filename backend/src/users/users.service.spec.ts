import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const createRepositoryMock = () => ({
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn((payload) => payload),
    save: jest.fn(async (payload) => payload),
  });

  const createNotificationsMock = () => ({
    createForUser: jest.fn().mockResolvedValue(undefined),
  });

  it('updates nickname and avatar profile fields', async () => {
    const repository = createRepositoryMock();
    const notifications = createNotificationsMock();
    repository.findOne.mockResolvedValue({
      id: 'user-1',
      nickname: '旧昵称',
      avatar: null,
    });

    const service = new UsersService(repository as any, notifications as any);
    const result = await service.updateProfile('user-1', {
      nickname: ' 新昵称 ',
      avatar: 'data:image/jpeg;base64,abc',
    });

    expect(result?.nickname).toBe('新昵称');
    expect(result?.avatar).toBe('data:image/jpeg;base64,abc');
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized avatar payload', async () => {
    const repository = createRepositoryMock();
    const notifications = createNotificationsMock();
    repository.findOne.mockResolvedValue({
      id: 'user-2',
      nickname: '用户',
      avatar: null,
    });

    const service = new UsersService(repository as any, notifications as any);
    const oversized = `data:image/jpeg;base64,${'a'.repeat(12 * 1024 * 1024 + 1)}`;

    await expect(
      service.updateProfile('user-2', {
        avatar: oversized,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('creates the first registered user as a normal user instead of super admin', async () => {
    const repository = createRepositoryMock();
    const notifications = createNotificationsMock();
    repository.findOne.mockResolvedValue(null);
    repository.count.mockResolvedValue(0);

    const service = new UsersService(repository as any, notifications as any);
    const created = await service.create('first@example.com', 'Secret123!', '第一个用户');

    expect(created.role).toBe('USER');
    expect(created.accountStatus).toBe('ACTIVE');
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'first@example.com',
        nickname: '第一个用户',
        role: 'USER',
      }),
    );
  });

  it('creates bootstrap super admin when the bootstrap account is missing', async () => {
    const repository = createRepositoryMock();
    const notifications = createNotificationsMock();
    repository.findOne.mockResolvedValue(null);

    const service = new UsersService(repository as any, notifications as any);

    await (service as any).ensureBootstrapSuperAdmin({
      email: 'admin@gmail.com',
      password: 'admin123',
      nickname: '系统管理员',
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@gmail.com',
        nickname: '系统管理员',
        role: 'SUPER_ADMIN',
        accountStatus: 'ACTIVE',
      }),
    );
  });

  it('does not overwrite bootstrap user password or status when the account already exists', async () => {
    const repository = createRepositoryMock();
    const notifications = createNotificationsMock();
    repository.findOne.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@gmail.com',
      password: 'existing-hash',
      nickname: '旧昵称',
      role: 'USER',
      accountStatus: 'DISABLED',
    });

    const service = new UsersService(repository as any, notifications as any);

    await (service as any).ensureBootstrapSuperAdmin({
      email: 'admin@gmail.com',
      password: 'new-password',
      nickname: '系统管理员',
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'admin-1',
        password: 'existing-hash',
        nickname: '旧昵称',
        role: 'SUPER_ADMIN',
        accountStatus: 'DISABLED',
      }),
    );
  });
});
