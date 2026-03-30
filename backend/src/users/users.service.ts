import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AccountStatus, MembershipLevel, User, UserRole } from './user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_AVATAR_DATA_LENGTH = 12 * 1024 * 1024;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async create(email: string, password: string, nickname: string): Promise<User> {
    const existingUser = await this.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('邮箱已被注册');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userCount = await this.usersRepository.count();
    const defaultRole: UserRole = userCount === 0 ? 'SUPER_ADMIN' : 'USER';
    const user = this.usersRepository.create({
      email,
      password: hashedPassword,
      nickname,
      role: defaultRole,
      membershipLevel: 'FREE',
      accountStatus: 'ACTIVE',
    });

    return this.usersRepository.save(user);
  }

  async syncRoleByPolicy(user: User): Promise<User> {
    if (!user) {
      return user;
    }

    const superAdminEmails = this.getConfiguredSuperAdminEmails();
    if (!superAdminEmails.size) {
      return user;
    }

    const email = String(user.email || '').trim().toLowerCase();
    if (!superAdminEmails.has(email)) {
      return user;
    }

    if (user.role === 'SUPER_ADMIN') {
      return user;
    }

    user.role = 'SUPER_ADMIN';
    return this.usersRepository.save(user);
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  async updateVIPStatus(
    userId: string,
    enableVip: boolean,
    expireDate?: Date,
  ): Promise<User | null> {
    const user = await this.findById(userId);
    if (!user) {
      return null;
    }

    const beforeIsVip = user.membershipLevel === 'VIP';
    const beforeExpireTime = user.vipExpireDate
      ? new Date(user.vipExpireDate).getTime()
      : 0;

    user.membershipLevel = enableVip ? 'VIP' : 'FREE';
    if (expireDate) {
      user.vipExpireDate = expireDate;
    } else if (!enableVip) {
      user.vipExpireDate = null;
    }

    const saved = await this.usersRepository.save(user);

    const afterExpireTime = saved.vipExpireDate
      ? new Date(saved.vipExpireDate).getTime()
      : 0;

    if (!beforeIsVip && saved.membershipLevel === 'VIP') {
      const dedupKey = `vip-activated:${saved.id}:${afterExpireTime || 'none'}`;
      await this.notificationsService.createForUser(saved.id, {
        type: 'VIP_ACTIVATED',
        level: 'success',
        source: 'vip',
        title: '会员已开通',
        content: '您的会员权益已生效，可下载更高画质并解锁更多能力。',
        actionUrl: '/vip',
        dedupKey,
      });
    } else if (
      beforeIsVip &&
      saved.membershipLevel === 'VIP' &&
      afterExpireTime > beforeExpireTime &&
      afterExpireTime > 0
    ) {
      const dedupKey = `vip-renewed:${saved.id}:${afterExpireTime}`;
      await this.notificationsService.createForUser(saved.id, {
        type: 'VIP_RENEWED',
        level: 'success',
        source: 'vip',
        title: '会员续费成功',
        content: `会员有效期已延长至 ${saved.vipExpireDate.toLocaleDateString('zh-CN')}。`,
        actionUrl: '/vip',
        dedupKey,
      });
    }

    return saved;
  }

  normalizeMembershipState(user: User): User {
    if (!user) {
      return user;
    }

    const membership: MembershipLevel =
      user.membershipLevel === 'VIP' ? 'VIP' : 'FREE';

    if (user.membershipLevel === membership) {
      return user;
    }

    user.membershipLevel = membership;
    return user;
  }

  isUserDisabled(user: User | null | undefined): boolean {
    if (!user) {
      return false;
    }
    return user.accountStatus === 'DISABLED';
  }

  async incrementDownloadCount(userId: string): Promise<User | null> {
    const user = await this.findById(userId);
    if (!user) {
      return null;
    }

    user.downloadCount += 1;
    return this.usersRepository.save(user);
  }

  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<User | null> {
    const user = await this.findById(userId);
    if (!user) {
      return null;
    }

    if (typeof updateProfileDto.nickname === 'string') {
      const nickname = updateProfileDto.nickname.trim();
      if (nickname) {
        user.nickname = nickname;
      }
    }

    if (typeof updateProfileDto.avatar === 'string') {
      const avatar = updateProfileDto.avatar.trim();
      if (avatar.length > MAX_AVATAR_DATA_LENGTH) {
        throw new BadRequestException('头像图片过大，请压缩后再上传');
      }
      user.avatar = avatar || null;
    }

    return this.usersRepository.save(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<User | null> {
    const user = await this.findById(userId);
    if (!user) {
      return null;
    }

    const validCurrentPassword = await this.validatePassword(user, currentPassword);
    if (!validCurrentPassword) {
      throw new BadRequestException('当前密码不正确');
    }

    const normalizedNewPassword = String(newPassword || '').trim();
    if (normalizedNewPassword.length < 6) {
      throw new BadRequestException('新密码长度至少为 6 位');
    }

    const isSamePassword = await bcrypt.compare(normalizedNewPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    user.password = await bcrypt.hash(normalizedNewPassword, 10);
    const saved = await this.usersRepository.save(user);
    const dedupKey = `password-changed:${saved.id}:${Date.now()}`;
    await this.notificationsService.createForUser(saved.id, {
      type: 'PASSWORD_CHANGED',
      level: 'warn',
      source: 'security',
      title: '密码已修改',
      content: '账号密码刚刚被修改。若非本人操作，请立即重置密码并检查登录设备。',
      actionUrl: '/user?tab=settings',
      dedupKey,
    });
    return saved;
  }

  async bindPhone(userId: string, phone: string): Promise<User | null> {
    const user = await this.findById(userId);
    if (!user) {
      return null;
    }

    const normalizedPhone = String(phone || '').replace(/\s+/g, '');
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      throw new BadRequestException('手机号格式不正确，请输入 11 位大陆手机号');
    }

    const existed = await this.usersRepository.findOne({
      where: { phone: normalizedPhone },
    });
    if (existed && existed.id !== userId) {
      throw new ConflictException('该手机号已被其他账号绑定');
    }

    user.phone = normalizedPhone;
    const saved = await this.usersRepository.save(user);
    const dedupKey = `phone-changed:${saved.id}:${normalizedPhone}`;
    await this.notificationsService.createForUser(saved.id, {
      type: 'PHONE_CHANGED',
      level: 'info',
      source: 'account',
      title: '手机号已更新',
      content: `手机号已绑定为 ${normalizedPhone}。`,
      actionUrl: '/user?tab=settings',
      dedupKey,
    });
    return saved;
  }

  private getConfiguredSuperAdminEmails(): Set<string> {
    const raw = String(process.env.SUPER_ADMIN_EMAILS || '').trim();
    if (!raw) {
      return new Set<string>();
    }

    return new Set(
      raw
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
  }
}
