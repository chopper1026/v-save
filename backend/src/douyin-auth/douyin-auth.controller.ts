import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DouyinAuthService } from './douyin-auth.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminUsersService } from '../admin/admin-users.service';
import { Public } from '../auth/public.decorator';
import { CompleteDouyinBridgeAuthDto } from './dto/complete-douyin-bridge-auth.dto';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
  };
}

@Controller('douyin/auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class DouyinAuthController {
  constructor(
    private readonly douyinAuthService: DouyinAuthService,
    private readonly adminUsersService: AdminUsersService,
  ) {}

  @Get('status')
  async getStatus() {
    const status = await this.douyinAuthService.getStatus();
    return {
      success: true,
      data: status,
    };
  }

  @Post('session')
  async saveSession(
    @Request() req: RequestWithUser,
    @Body('cookie') cookie?: string,
  ) {
    if (!cookie?.trim()) {
      throw new BadRequestException('缺少 Cookie');
    }

    await this.douyinAuthService.saveCookie(cookie);
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'DOUYIN_COOKIE_SAVED',
      module: 'AUTH',
      platform: 'DOUYIN',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      reason: '手动保存抖音 Cookie',
    });
    return {
      success: true,
      message: '抖音 Cookie 已保存',
    };
  }

  @Post('bridge/start')
  async startBridgeAuth(@Request() req: RequestWithUser) {
    const data = await this.douyinAuthService.startBridgeAuth({
      adminUserId: req.user?.id,
      adminEmail: req.user?.email,
    });
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'DOUYIN_BRIDGE_AUTH_STARTED',
      module: 'AUTH',
      platform: 'DOUYIN',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      afterState: {
        authSessionId: data.authSessionId,
        status: data.status,
        expiresAt: data.expiresAt,
      },
      reason: '发起抖音桥接登录会话',
    });
    return {
      success: true,
      data,
    };
  }

  @Get('bridge/status')
  async getBridgeStatus(@Query('authSessionId') authSessionId?: string) {
    if (!authSessionId?.trim()) {
      throw new BadRequestException('缺少 authSessionId');
    }

    const data = await this.douyinAuthService.getBridgeAuthStatus(authSessionId);
    return {
      success: true,
      data,
    };
  }

  @Post('bridge/complete')
  @Public()
  async completeBridgeAuth(
    @Request() req: RequestWithUser,
    @Body() payload: CompleteDouyinBridgeAuthDto,
  ) {
    const data = await this.douyinAuthService.completeBridgeAuth(payload);
    return {
      success: true,
      data,
    };
  }

  @Delete('session')
  async clearSession(@Request() req: RequestWithUser) {
    await this.douyinAuthService.clearSession();
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'DOUYIN_SESSION_CLEARED',
      module: 'AUTH',
      platform: 'DOUYIN',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      reason: '清空抖音登录态',
    });
    return {
      success: true,
      message: '抖音登录态已清空',
    };
  }
}
