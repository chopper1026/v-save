import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AdminUsersService } from './admin-users.service';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    role: 'SUPER_ADMIN' | 'USER';
  };
}

@Controller('admin/system-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminSystemSettingsController {
  constructor(
    private readonly systemSettingsService: SystemSettingsService,
    private readonly adminUsersService: AdminUsersService,
  ) {}

  @Get()
  async getSettings() {
    return {
      success: true,
      data: await this.systemSettingsService.getAdminSettings(),
    };
  }

  @Put()
  async updateSettings(
    @Request() req: RequestWithUser,
    @Body() body: UpdateSystemSettingsDto,
  ) {
    const before = await this.systemSettingsService.getAdminSettings();
    const updated = await this.systemSettingsService.updateSettings({
      registrationEnabled: body.registrationEnabled,
    });

    await this.adminUsersService.recordAuditLog({
      adminUserId: req.user?.id || '',
      action: 'UPDATE_SYSTEM_SETTING',
      module: 'SYSTEM',
      platform: 'NONE',
      targetType: 'SYSTEM',
      beforeState: before,
      afterState: updated,
      reason: body.reason,
    });

    return {
      success: true,
      data: updated,
    };
  }
}
