import {
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { User } from '../users/user.entity';
import {
  SUPER_ADMIN_ONLY_NOTIFICATION_TYPES,
  NotificationType,
  isSuperAdminOnlyNotificationType,
} from './notification-types';

export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';
export type NotificationSource =
  | 'auth'
  | 'account'
  | 'security'
  | 'system';

interface CreateNotificationInput {
  userId?: string | null;
  type: NotificationType | string;
  title: string;
  content: string;
  level?: NotificationLevel;
  source?: NotificationSource;
  payload?: Record<string, any> | null;
  actionUrl?: string | null;
  dedupKey?: string | null;
}

interface QueryNotificationsInput {
  userId: string;
  unreadOnly?: boolean;
  type?: string;
  page?: number;
  pageSize?: number;
}

interface CreateForSuperAdminsOptions {
  skipIfUnreadDedupKeyPrefix?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const dedupKey = String(input.dedupKey || '').trim() || null;
    if (dedupKey) {
      const existed = await this.notificationRepository.findOne({
        where: { dedupKey },
      });
      if (existed) {
        return existed;
      }
    }

    const entity = this.notificationRepository.create({
      userId: input.userId || null,
      type: String(input.type || '').trim(),
      title: String(input.title || '').trim().slice(0, 120),
      content: String(input.content || '').trim(),
      level: input.level || 'info',
      source: input.source || 'system',
      payload: input.payload || null,
      actionUrl: input.actionUrl || null,
      dedupKey,
      isRead: false,
      readAt: null,
    });

    return this.notificationRepository.save(entity);
  }

  async createGlobal(input: Omit<CreateNotificationInput, 'userId'>): Promise<void> {
    if (isSuperAdminOnlyNotificationType(input.type)) {
      await this.createForSuperAdmins(input);
      return;
    }

    const users = await this.userRepository.find({
      select: ['id'],
    });

    if (!users.length) {
      return;
    }

    await Promise.all(
      users.map((user) =>
        this.create({
          ...input,
          userId: user.id,
          dedupKey: input.dedupKey ? `${input.dedupKey}:u:${user.id}` : null,
        }),
      ),
    );
  }

  async createForSuperAdmins(
    input: Omit<CreateNotificationInput, 'userId'>,
    options?: CreateForSuperAdminsOptions,
  ): Promise<void> {
    const superAdmins = await this.userRepository.find({
      select: ['id'],
      where: {
        role: 'SUPER_ADMIN',
        accountStatus: 'ACTIVE',
      },
    });

    if (!superAdmins.length) {
      return;
    }

    const unreadDedupKeyPrefix = String(
      options?.skipIfUnreadDedupKeyPrefix || '',
    ).trim();

    await Promise.all(
      superAdmins.map(async (user) => {
        if (unreadDedupKeyPrefix) {
          const hasUnread = await this.hasUnreadNotificationWithDedupKeyPrefix(
            user.id,
            unreadDedupKeyPrefix,
          );
          if (hasUnread) {
            return;
          }
        }

        await this.create({
          ...input,
          userId: user.id,
          dedupKey: input.dedupKey ? `${input.dedupKey}:u:${user.id}` : null,
        });
      }),
    );
  }

  async createForUser(
    userId: string,
    input: Omit<CreateNotificationInput, 'userId'>,
  ): Promise<Notification> {
    return this.create({
      ...input,
      userId,
    });
  }

  async queryForUser(input: QueryNotificationsInput): Promise<{
    items: Notification[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(input.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(input.pageSize) || 20));
    const unreadOnly = !!input.unreadOnly;
    const type = String(input.type || '').trim();
    const includeSuperAdminOnly = await this.isSuperAdminUser(input.userId);

    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', {
        userId: input.userId,
      });

    this.applyNotificationAudienceFilter(qb, includeSuperAdminOnly);

    if (unreadOnly) {
      qb.andWhere('notification.isRead = :isRead', { isRead: false });
    }

    if (type) {
      qb.andWhere('notification.type = :type', { type });
    }

    qb.orderBy('notification.createdAt', 'DESC');
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const includeSuperAdminOnly = await this.isSuperAdminUser(userId);

    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', {
        userId,
      })
      .andWhere('notification.isRead = :isRead', { isRead: false });
    this.applyNotificationAudienceFilter(qb, includeSuperAdminOnly);

    const count = await qb.getCount();
    return count;
  }

  async markAsRead(userId: string, notificationId: string): Promise<boolean> {
    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true, readAt: new Date() })
      .where('id = :id', { id: notificationId })
      .andWhere('userId = :userId', { userId })
      .andWhere('isRead = :isRead', { isRead: false })
      .execute();

    return (result.affected || 0) > 0;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true, readAt: new Date() })
      .where('userId = :userId', { userId })
      .andWhere('isRead = :isRead', { isRead: false })
      .execute();
    return result.affected || 0;
  }

  async clearAllForUser(userId: string): Promise<number> {
    const result = await this.notificationRepository
      .createQueryBuilder()
      .delete()
      .where('userId = :userId', { userId })
      .execute();
    return result.affected || 0;
  }

  private async isSuperAdminUser(userId: string): Promise<boolean> {
    const id = String(userId || '').trim();
    if (!id) {
      return false;
    }

    const user = await this.userRepository.findOne({
      select: ['id', 'role'],
      where: { id },
    });

    return user?.role === 'SUPER_ADMIN';
  }

  private applyNotificationAudienceFilter(
    qb: {
      andWhere: (
        where: string,
        parameters?: Record<string, unknown>,
      ) => unknown;
    },
    includeSuperAdminOnly: boolean,
  ): void {
    if (includeSuperAdminOnly) {
      return;
    }

    if (!SUPER_ADMIN_ONLY_NOTIFICATION_TYPES.length) {
      return;
    }

    qb.andWhere('notification.type NOT IN (:...excludedTypes)', {
      excludedTypes: SUPER_ADMIN_ONLY_NOTIFICATION_TYPES,
    });
  }

  private async hasUnreadNotificationWithDedupKeyPrefix(
    userId: string,
    dedupKeyPrefix: string,
  ): Promise<boolean> {
    const id = String(userId || '').trim();
    const prefix = String(dedupKeyPrefix || '').trim();
    if (!id || !prefix) {
      return false;
    }

    const existed = await this.notificationRepository.findOne({
      select: ['id'],
      where: {
        userId: id,
        isRead: false,
        dedupKey: Like(`${prefix}%`),
      } as any,
    });
    return !!existed;
  }
}
