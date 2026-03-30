import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationLevel, NotificationsService } from '../notifications/notifications.service';
import {
  AccountStatus,
  MembershipLevel,
  User,
  UserRole,
} from '../users/user.entity';
import { QueryAdminAuditDto } from './dto/query-admin-audit.dto';
import { QueryAdminUsersDto } from './dto/query-admin-users.dto';
import { UpdateUserMembershipDto } from './dto/update-user-membership.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import {
  AdminAuditModule,
  AdminAuditPlatform,
  AdminAuditTargetType,
  UserAdminAuditLog,
} from './entities/user-admin-audit-log.entity';

export interface AdminUserView {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  membershipLevel: MembershipLevel;
  accountStatus: AccountStatus;
  phone: string | null;
  avatar: string | null;
  vipExpireDate: Date | null;
  downloadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAdminAuditLogInput {
  adminUserId: string;
  action: string;
  module: AdminAuditModule;
  platform?: AdminAuditPlatform;
  targetType?: AdminAuditTargetType;
  targetUserId?: string | null;
  targetEmail?: string | null;
  beforeState?: Record<string, any> | null;
  afterState?: Record<string, any> | null;
  reason?: string;
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserAdminAuditLog)
    private readonly auditLogRepository: Repository<UserAdminAuditLog>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async queryUsers(query: QueryAdminUsersDto): Promise<{
    items: AdminUserView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

    const qb = this.userRepository.createQueryBuilder('user');
    const keyword = String(query.keyword || '').trim();
    if (keyword) {
      qb.andWhere(
        '(user.email LIKE :keyword OR user.nickname LIKE :keyword OR user.phone LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    if (query.role) {
      qb.andWhere('user.role = :role', { role: query.role });
    }
    if (query.membershipLevel) {
      qb.andWhere('user.membershipLevel = :membershipLevel', {
        membershipLevel: query.membershipLevel,
      });
    }
    if (query.accountStatus) {
      qb.andWhere('user.accountStatus = :accountStatus', {
        accountStatus: query.accountStatus,
      });
    }

    qb
      .orderBy("CASE WHEN user.role = 'SUPER_ADMIN' THEN 0 ELSE 1 END", 'ASC')
      .addOrderBy('user.createdAt', 'ASC');
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [users, total] = await qb.getManyAndCount();
    return {
      items: users.map((user) => this.toAdminUserView(user)),
      total,
      page,
      pageSize,
    };
  }

  async queryAuditLogs(query: QueryAdminAuditDto): Promise<{
    items: UserAdminAuditLog[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

    const qb = this.auditLogRepository.createQueryBuilder('log');
    if (query.targetUserId) {
      qb.andWhere('log.targetUserId = :targetUserId', {
        targetUserId: query.targetUserId,
      });
    }
    if (query.adminUserId) {
      qb.andWhere('log.adminUserId = :adminUserId', {
        adminUserId: query.adminUserId,
      });
    }
    if (query.module) {
      qb.andWhere('log.module = :module', {
        module: query.module,
      });
    }
    if (query.platform) {
      qb.andWhere('log.platform = :platform', {
        platform: query.platform,
      });
    }
    const keyword = String(query.keyword || '').trim();
    if (keyword) {
      qb.andWhere(
        '(log.action LIKE :keyword OR log.adminEmail LIKE :keyword OR log.targetEmail LIKE :keyword OR log.reason LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }
    qb.orderBy('log.createdAt', 'DESC');
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async updateRole(
    adminUserId: string,
    targetUserId: string,
    dto: UpdateUserRoleDto,
  ): Promise<AdminUserView> {
    const admin = await this.mustGetUser(adminUserId);
    const target = await this.mustGetUser(targetUserId);
    const nextRole = dto.role;

    if (target.id === admin.id && nextRole !== 'SUPER_ADMIN') {
      throw new BadRequestException('不能将自己降级为普通用户');
    }

    const before = this.toAdminUserView(target);
    if (before.role === nextRole) {
      return before;
    }

    if (before.role === 'SUPER_ADMIN' && nextRole !== 'SUPER_ADMIN') {
      const superAdminCount = await this.userRepository.count({
        where: { role: 'SUPER_ADMIN' },
      });
      if (superAdminCount <= 1) {
        throw new BadRequestException('系统至少需要保留一个超级管理员');
      }
    }

    target.role = nextRole;
    const saved = await this.userRepository.save(target);
    const after = this.toAdminUserView(saved);

    await this.writeAuditLog(admin, saved, {
      action: 'UPDATE_ROLE',
      module: 'ROLE',
      platform: 'NONE',
      targetType: 'USER',
      beforeState: before,
      afterState: after,
      reason:
        dto.reason ||
        `角色由 ${before.role} 调整为 ${after.role}`,
    });
    await this.notifyUser(
      saved.id,
      'ROLE_UPDATED',
      '账号角色已调整',
      `您的账号角色已调整为 ${after.role === 'SUPER_ADMIN' ? '超级管理员' : '普通用户'}。`,
      'account',
      'info',
      '/user',
    );

    return after;
  }

  async updateMembership(
    adminUserId: string,
    targetUserId: string,
    dto: UpdateUserMembershipDto,
  ): Promise<AdminUserView> {
    const admin = await this.mustGetUser(adminUserId);
    const target = await this.mustGetUser(targetUserId);
    const before = this.toAdminUserView(target);

    const nextMembership = dto.membershipLevel;
    target.membershipLevel = nextMembership;

    if (nextMembership === 'FREE') {
      target.vipExpireDate = null;
    } else if (dto.vipExpireDate) {
      const parsed = new Date(dto.vipExpireDate);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('vipExpireDate 格式不正确');
      }
      target.vipExpireDate = parsed;
    }

    const saved = await this.userRepository.save(target);
    const after = this.toAdminUserView(saved);

    await this.writeAuditLog(admin, saved, {
      action: 'UPDATE_MEMBERSHIP',
      module: 'USER',
      platform: 'NONE',
      targetType: 'USER',
      beforeState: before,
      afterState: after,
      reason:
        dto.reason ||
        `会员由 ${before.membershipLevel} 调整为 ${after.membershipLevel}`,
    });

    const content =
      after.membershipLevel === 'VIP'
        ? `您的会员状态已更新为 VIP${after.vipExpireDate ? `（有效期至 ${after.vipExpireDate.toLocaleDateString('zh-CN')}）` : ''}。`
        : '您的会员状态已更新为普通会员（FREE）。';
    await this.notifyUser(
      saved.id,
      'MEMBERSHIP_UPDATED',
      '会员状态已更新',
      content,
      'vip',
      'success',
      '/vip',
    );

    return after;
  }

  async updateStatus(
    adminUserId: string,
    targetUserId: string,
    dto: UpdateUserStatusDto,
  ): Promise<AdminUserView> {
    const admin = await this.mustGetUser(adminUserId);
    const target = await this.mustGetUser(targetUserId);

    if (admin.id === target.id && dto.accountStatus === 'DISABLED') {
      throw new BadRequestException('不能禁用当前登录账号');
    }

    const before = this.toAdminUserView(target);
    if (before.accountStatus === dto.accountStatus) {
      return before;
    }

    if (before.role === 'SUPER_ADMIN' && dto.accountStatus === 'DISABLED') {
      const activeSuperAdminCount = await this.userRepository.count({
        where: {
          role: 'SUPER_ADMIN',
          accountStatus: 'ACTIVE',
        },
      });
      if (activeSuperAdminCount <= 1) {
        throw new BadRequestException('系统至少需要一个启用状态的超级管理员');
      }
    }

    target.accountStatus = dto.accountStatus;
    const saved = await this.userRepository.save(target);
    const after = this.toAdminUserView(saved);

    await this.writeAuditLog(admin, saved, {
      action: 'UPDATE_STATUS',
      module: 'USER',
      platform: 'NONE',
      targetType: 'USER',
      beforeState: before,
      afterState: after,
      reason:
        dto.reason ||
        `状态由 ${before.accountStatus} 调整为 ${after.accountStatus}`,
    });

    await this.notifyUser(
      saved.id,
      after.accountStatus === 'DISABLED'
        ? 'ACCOUNT_DISABLED'
        : 'ACCOUNT_ENABLED',
      after.accountStatus === 'DISABLED' ? '账号已被禁用' : '账号已恢复启用',
      after.accountStatus === 'DISABLED'
        ? '您的账号已被管理员禁用，如有疑问请联系平台管理员。'
        : '您的账号已恢复启用，可继续使用系统能力。',
      'security',
      after.accountStatus === 'DISABLED' ? 'warn' : 'success',
      '/user',
    );

    return after;
  }

  private async mustGetUser(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  private toAdminUserView(user: User): AdminUserView {
    const membershipLevel: MembershipLevel =
      user.membershipLevel === 'VIP' ? 'VIP' : 'FREE';
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      role: user.role || 'USER',
      membershipLevel,
      accountStatus: user.accountStatus || 'ACTIVE',
      phone: user.phone || null,
      avatar: user.avatar || null,
      vipExpireDate: user.vipExpireDate ? new Date(user.vipExpireDate) : null,
      downloadCount: Number(user.downloadCount || 0),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async recordAuditLog(input: CreateAdminAuditLogInput): Promise<void> {
    const admin = await this.mustGetUser(input.adminUserId);
    const targetUserId = input.targetUserId || admin.id;
    const targetEmail = input.targetEmail || admin.email || null;

    const entity = this.auditLogRepository.create({
      adminUserId: admin.id,
      adminEmail: admin.email,
      targetUserId,
      targetEmail,
      action: input.action,
      module: input.module,
      platform: input.platform || 'NONE',
      targetType: input.targetType || 'SYSTEM',
      beforeState: input.beforeState || null,
      afterState: input.afterState || null,
      reason: input.reason ? input.reason.trim().slice(0, 255) : null,
    });
    await this.auditLogRepository.save(entity);
  }

  private async writeAuditLog(
    admin: User,
    target: User,
    payload: {
      action: string;
      module: AdminAuditModule;
      platform?: AdminAuditPlatform;
      targetType?: AdminAuditTargetType;
      beforeState?: Record<string, any> | null;
      afterState?: Record<string, any> | null;
      reason?: string;
    },
  ): Promise<void> {
    const entity = this.auditLogRepository.create({
      adminUserId: admin.id,
      adminEmail: admin.email,
      targetUserId: target.id,
      targetEmail: target.email,
      action: payload.action,
      module: payload.module,
      platform: payload.platform || 'NONE',
      targetType: payload.targetType || 'USER',
      beforeState: payload.beforeState || null,
      afterState: payload.afterState || null,
      reason: payload.reason ? payload.reason.trim().slice(0, 255) : null,
    });
    await this.auditLogRepository.save(entity);
  }

  private async notifyUser(
    userId: string,
    type: string,
    title: string,
    content: string,
    source: 'auth' | 'vip' | 'account' | 'security' | 'system',
    level: NotificationLevel,
    actionUrl: string,
  ): Promise<void> {
    const dedupKey = `${type}:${userId}:${Math.floor(Date.now() / (30 * 60 * 1000))}`;
    await this.notificationsService.createForUser(userId, {
      type,
      title,
      content,
      source,
      level,
      actionUrl,
      dedupKey,
    });
  }
}
