import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'v-save-secret-key',
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role?: string;
    accountStatus?: string;
  }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (this.usersService.isUserDisabled(user)) {
      throw new UnauthorizedException('账号已被禁用');
    }

    const syncedUser = await this.usersService.syncRoleByPolicy(user);
    return {
      id: syncedUser.id,
      email: syncedUser.email,
      role: syncedUser.role,
      accountStatus: syncedUser.accountStatus,
    };
  }
}
