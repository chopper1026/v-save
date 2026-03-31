import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';

@Injectable()
export class SuperAdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminBootstrapService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onApplicationBootstrap() {
    const email = String(
      this.configService.get<string>('SUPER_ADMIN_BOOTSTRAP_EMAIL', 'admin@gmail.com'),
    ).trim();
    const password = String(
      this.configService.get<string>('SUPER_ADMIN_BOOTSTRAP_PASSWORD', 'admin123'),
    ).trim();
    const nickname = String(
      this.configService.get<string>('SUPER_ADMIN_BOOTSTRAP_NICKNAME', '系统管理员'),
    ).trim() || '系统管理员';

    if (!email || !password) {
      this.logger.warn('超级管理员 bootstrap 配置不完整，已跳过默认超管初始化。');
      return;
    }

    await this.usersService.ensureBootstrapSuperAdmin({
      email,
      password,
      nickname,
    });
  }
}
