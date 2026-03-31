import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { SystemSettingsService } from './system-settings.service';

@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Get('public')
  @Public()
  async getPublicSettings() {
    return {
      success: true,
      data: await this.systemSettingsService.getPublicSettings(),
    };
  }
}
