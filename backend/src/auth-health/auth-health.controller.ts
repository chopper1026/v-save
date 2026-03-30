import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthHealthService } from './auth-health.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('auth/health')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AuthHealthController {
  constructor(private readonly authHealthService: AuthHealthService) {}

  @Get()
  async getStatus(@Query('sync') sync?: string) {
    const shouldSync = sync === '1' || sync === 'true';
    const data = await this.authHealthService.getHealthStatus(shouldSync);
    return {
      success: true,
      data,
    };
  }
}
