import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BilibiliAuthService } from './bilibili-auth.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminUsersService } from '../admin/admin-users.service';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
  };
}

@Controller('bilibili/auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class BilibiliAuthController {
  constructor(
    private readonly bilibiliAuthService: BilibiliAuthService,
    private readonly adminUsersService: AdminUsersService,
  ) {}

  @Get('status')
  async getStatus(@Query('sync') sync?: string) {
    const shouldSync = sync === '1' || sync === 'true';
    const status = await this.bilibiliAuthService.getStatus(shouldSync);
    return {
      success: true,
      data: status,
    };
  }

  @Post('qrcode')
  async generateQrCode(@Request() req: RequestWithUser) {
    const data = await this.bilibiliAuthService.generateQrCode();
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'BILIBILI_QRCODE_GENERATED',
      module: 'AUTH',
      platform: 'BILIBILI',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      afterState: {
        expireAt: data.expireAt,
      },
      reason: '生成 B站扫码登录二维码',
    });
    return {
      success: true,
      data,
    };
  }

  @Get('qrcode/poll')
  async pollQrCode(
    @Request() req: RequestWithUser,
    @Query('qrcodeKey') qrcodeKey?: string,
  ) {
    if (!qrcodeKey?.trim()) {
      throw new BadRequestException('缺少 qrcodeKey');
    }

    const result = await this.bilibiliAuthService.pollQrLogin(qrcodeKey);
    if (result.status === 'confirmed') {
      await this.adminUsersService.recordAuditLog({
        adminUserId: req.user?.id || '',
        action: 'BILIBILI_QRCODE_CONFIRMED',
        module: 'AUTH',
        platform: 'BILIBILI',
        targetType: 'AUTH_SESSION',
        targetUserId: req.user?.id || null,
        targetEmail: req.user?.email || null,
        afterState: {
          status: result.status,
          message: result.message,
        },
        reason: result.message || 'B站扫码登录确认成功',
      });
    }
    return {
      success: true,
      data: result,
    };
  }

  @Post('refresh')
  async refreshCookie(@Request() req: RequestWithUser) {
    const result = await this.bilibiliAuthService.refreshCookieIfNeeded(false);
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'BILIBILI_COOKIE_REFRESHED',
      module: 'AUTH',
      platform: 'BILIBILI',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      afterState: result,
      reason: result.message || '执行 B站登录态检查/刷新',
    });
    return {
      success: true,
      data: result,
    };
  }

  @Delete('session')
  async clearSession(@Request() req: RequestWithUser) {
    await this.bilibiliAuthService.clearSession();
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'BILIBILI_SESSION_CLEARED',
      module: 'AUTH',
      platform: 'BILIBILI',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      reason: '清空 B站登录态',
    });
    return {
      success: true,
      message: 'B站登录态已清空',
    };
  }
}
