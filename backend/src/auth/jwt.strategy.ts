import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { readJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: readJwtSecret(configService),
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
