import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  const notificationsService = {
    queryForUser: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    clearAllForUser: jest.fn(),
  };

  let controller: NotificationsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new NotificationsController(notificationsService as any);
  });

  it('clears all notifications for current user', async () => {
    notificationsService.clearAllForUser.mockResolvedValue(5);
    const req = {
      user: {
        id: 'user-1',
      },
    } as any;

    const result = await controller.clearAll(req);

    expect(notificationsService.clearAllForUser).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      success: true,
      data: {
        affected: 5,
      },
    });
  });
});

