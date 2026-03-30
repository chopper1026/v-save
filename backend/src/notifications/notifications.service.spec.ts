import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const createNotificationRepositoryMock = () => ({
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((payload) => payload),
    save: jest.fn(async (payload) => payload),
    createQueryBuilder: jest.fn(),
  });

  const createUserRepositoryMock = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
    save: jest.fn(async (payload) => payload),
  });

  it('routes auth internal notifications to super admins only when createGlobal is used', async () => {
    const notificationRepository = createNotificationRepositoryMock();
    const userRepository = createUserRepositoryMock();

    userRepository.find.mockImplementation(async (options?: any) => {
      if (options?.where?.role === 'SUPER_ADMIN') {
        return [{ id: 'admin-1' }];
      }
      return [{ id: 'admin-1' }, { id: 'user-1' }];
    });

    const service = new NotificationsService(
      notificationRepository as any,
      userRepository as any,
    );

    await service.createGlobal({
      type: 'COOKIE_RISK',
      title: '登录态异常',
      content: '请处理登录态',
      source: 'auth',
      level: 'warn',
      actionUrl: '/admin?tab=auth',
    });

    expect(notificationRepository.save).toHaveBeenCalledTimes(1);
    expect(notificationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        type: 'COOKIE_RISK',
      }),
    );
  });

  it('filters auth internal notifications for non-super-admin users in query list', async () => {
    const notificationRepository = createNotificationRepositoryMock();
    const userRepository = createUserRepositoryMock();

    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    notificationRepository.createQueryBuilder.mockReturnValue(qb);
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
    });

    const service = new NotificationsService(
      notificationRepository as any,
      userRepository as any,
    );

    await service.queryForUser({
      userId: 'user-1',
      page: 1,
      pageSize: 20,
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'notification.type NOT IN (:...excludedTypes)',
      expect.objectContaining({
        excludedTypes: expect.arrayContaining([
          'COOKIE_RISK',
          'COOKIE_EXPIRED',
          'AUTH_RECOVERED',
        ]),
      }),
    );
  });

  it('skips sending repeated auth invalid notification when unread exists for the same platform', async () => {
    const notificationRepository = createNotificationRepositoryMock();
    const userRepository = createUserRepositoryMock();

    userRepository.find.mockResolvedValue([
      { id: 'admin-1' },
      { id: 'admin-2' },
    ]);

    notificationRepository.findOne.mockImplementation(async (options?: any) => {
      const where = options?.where || {};
      if (
        where.userId === 'admin-1'
        && where.isRead === false
      ) {
        return { id: 'existing-unread' };
      }
      return null;
    });

    const service = new NotificationsService(
      notificationRepository as any,
      userRepository as any,
    );

    await service.createForSuperAdmins(
      {
        type: 'COOKIE_EXPIRED',
        title: '登录态可能已失效',
        content: '请重新登录',
        source: 'auth',
        level: 'error',
        actionUrl: '/admin?tab=auth',
        dedupKey: 'auth-problem:douyin:COOKIE_EXPIRED:123',
      },
      {
        skipIfUnreadDedupKeyPrefix: 'auth-problem:douyin:COOKIE_EXPIRED:',
      },
    );

    expect(notificationRepository.save).toHaveBeenCalledTimes(1);
    expect(notificationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-2',
        type: 'COOKIE_EXPIRED',
      }),
    );
  });

  it('clears all notifications for current user', async () => {
    const notificationRepository = createNotificationRepositoryMock();
    const userRepository = createUserRepositoryMock();
    const execute = jest.fn().mockResolvedValue({ affected: 4 });
    notificationRepository.createQueryBuilder.mockReturnValue({
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute,
    });

    const service = new NotificationsService(
      notificationRepository as any,
      userRepository as any,
    );

    const affected = await service.clearAllForUser('user-1');
    expect(affected).toBe(4);
  });
});
