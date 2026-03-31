import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SystemSettingsService } from '../system-settings/system-settings.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private readonly systemSettingsService?: SystemSettingsService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return null;
    }

    if (this.usersService.isUserDisabled(user)) {
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }

    const isPasswordValid = await this.usersService.validatePassword(user, password);
    if (!isPasswordValid) {
      return null;
    }

    const syncedUser = await this.usersService.syncRoleByPolicy(user);
    const { password: _, ...result } = syncedUser;
    return result;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
        accountStatus: user.accountStatus,
        avatar: user.avatar,
        phone: user.phone,
        downloadCount: user.downloadCount,
      },
    };
  }

  async register(registerDto: RegisterDto) {
    const settings = await this.systemSettingsService?.getPublicSettings?.();
    if (settings && settings.registrationEnabled === false) {
      throw new ForbiddenException('当前未开放注册');
    }

    const user = await this.usersService.create(
      registerDto.email,
      registerDto.password,
      registerDto.nickname,
    );

    const syncedUser = await this.usersService.syncRoleByPolicy(user);
    const payload = {
      sub: syncedUser.id,
      email: syncedUser.email,
      role: syncedUser.role,
      accountStatus: syncedUser.accountStatus,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: syncedUser.id,
        email: syncedUser.email,
        nickname: syncedUser.nickname,
        role: syncedUser.role,
        accountStatus: syncedUser.accountStatus,
        avatar: syncedUser.avatar,
        phone: syncedUser.phone,
        downloadCount: syncedUser.downloadCount,
      },
    };
  }
}
