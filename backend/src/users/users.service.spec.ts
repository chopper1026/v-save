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
});
