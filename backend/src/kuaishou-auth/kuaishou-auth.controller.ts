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
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUsersService } from '../admin/admin-users.service';
import { KuaishouAuthService } from './kuaishou-auth.service';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
  };
}

@Controller('kuaishou/auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class KuaishouAuthController {
  constructor(
    private readonly kuaishouAuthService: KuaishouAuthService,
    private readonly adminUsersService: AdminUsersService,
  ) {}

  @Get('status')
  async getStatus() {
    const status = await this.kuaishouAuthService.getStatus();
    return {
      success: true,
      data: status,
    };
  }

  @Post('qrcode')
  async generateQrCode(@Request() req: RequestWithUser) {
    const data = await this.kuaishouAuthService.generateQrCode();
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'KUAISHOU_QRCODE_GENERATED',
      module: 'AUTH',
      platform: 'KUAISHOU',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      afterState: {
        expireAt: data.expireAt,
      },
      reason: '生成快手扫码登录二维码',
    });
    return {
      success: true,
      data,
    };
  }

  @Get('qrcode/poll')
  async pollQrCode(
    @Request() req: RequestWithUser,
    @Query('qrLoginToken') qrLoginToken?: string,
    @Query('qrLoginSignature') qrLoginSignature?: string,
  ) {
    if (!qrLoginToken?.trim() || !qrLoginSignature?.trim()) {
      throw new BadRequestException('缺少快手二维码轮询参数');
    }

    const data = await this.kuaishouAuthService.pollQrLogin(
      qrLoginToken,
      qrLoginSignature,
    );
    if (data.status === 'confirmed') {
      await this.adminUsersService.recordAuditLog({
        adminUserId: req.user?.id || '',
        action: 'KUAISHOU_QRCODE_CONFIRMED',
        module: 'AUTH',
        platform: 'KUAISHOU',
        targetType: 'AUTH_SESSION',
        targetUserId: req.user?.id || null,
        targetEmail: req.user?.email || null,
        afterState: {
          status: data.status,
          message: data.message,
        },
        reason: '快手扫码登录确认成功',
      });
    }
    return {
      success: true,
      data,
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

    await this.kuaishouAuthService.saveCookie(cookie);
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'KUAISHOU_COOKIE_SAVED',
      module: 'AUTH',
      platform: 'KUAISHOU',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      reason: '手动保存快手 Cookie',
    });
    return {
      success: true,
      message: '快手 Cookie 已保存',
    };
  }

  @Delete('session')
  async clearSession(@Request() req: RequestWithUser) {
    await this.kuaishouAuthService.clearSession();
    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'KUAISHOU_SESSION_CLEARED',
      module: 'AUTH',
      platform: 'KUAISHOU',
      targetType: 'AUTH_SESSION',
      targetUserId: req.user?.id || null,
      targetEmail: req.user?.email || null,
      reason: '清空快手登录态',
    });
    return {
      success: true,
      message: '快手登录态已清空',
    };
  }
}
