import { Body, Controller, Get, Param, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminUsersService } from './admin-users.service';
import { UpdateDownloadModeConfigDto } from './dto/update-download-mode-config.dto';
import { DownloadModeService } from '../download-mode/download-mode.service';
import {
  DownloadClientType,
  DownloadModePlatform,
} from '../download-mode/download-mode.types';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    role: 'SUPER_ADMIN' | 'USER';
  };
}

@Controller('admin/download-modes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminDownloadModesController {
  constructor(
    private readonly downloadModeService: DownloadModeService,
    private readonly adminUsersService: AdminUsersService,
  ) {}

  @Get('schema')
  getSchema() {
    return {
      success: true,
      data: this.downloadModeService.getSchema(),
    };
  }

  @Get('configs')
  async getConfigs() {
    return {
      success: true,
      data: await this.downloadModeService.getConfigs(),
    };
  }

  @Put('configs/:platform/:clientType')
  async updateConfig(
    @Request() req: RequestWithUser,
    @Param('platform') platform: DownloadModePlatform,
    @Param('clientType') clientType: DownloadClientType,
    @Body() body: UpdateDownloadModeConfigDto,
  ) {
    const adminUserId = req.user?.id || '';
    const adminEmail = req.user?.email || null;
    const beforeConfigs = (await this.downloadModeService.getConfigs()) || [];
    const before =
      beforeConfigs.find((item) => item.platform === platform)?.clients?.[clientType] ||
      null;

    const updated = await this.downloadModeService.updateModeConfig({
      platform,
      clientType,
      mode: body.mode,
      updatedByUserId: adminUserId,
      updatedByEmail: adminEmail || '',
    });

    await this.adminUsersService.recordAuditLog({
      adminUserId,
      action: 'UPDATE_DOWNLOAD_MODE',
      module: 'DOWNLOAD_POLICY',
      platform: platform === DownloadModePlatform.DOUYIN ? 'DOUYIN' : platform === DownloadModePlatform.BILIBILI ? 'BILIBILI' : 'NONE',
      targetType: 'SYSTEM',
      beforeState: before,
      afterState: updated,
      reason:
        body.reason ||
        `${platform} ${clientType} 下载模式调整为 ${body.mode}`,
    });

    return {
      success: true,
      data: updated,
    };
  }
}
