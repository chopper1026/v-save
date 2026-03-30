import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { QueryRuntimeChainsDto } from './dto/query-runtime-chains.dto';
import { QueryRuntimeDashboardDto } from './dto/query-runtime-dashboard.dto';
import { RuntimeMonitorService } from './runtime-monitor.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminRuntimeDashboardController {
  constructor(private readonly runtimeMonitorService: RuntimeMonitorService) {}

  @Get('runtime-dashboard')
  async getDashboard(@Query() query: QueryRuntimeDashboardDto) {
    const data = await this.runtimeMonitorService.getRuntimeDashboard(
      query.window || 'today',
    );
    return {
      success: true,
      data,
    };
  }

  @Get('runtime-dashboard/chains')
  async getChains(@Query() query: QueryRuntimeChainsDto) {
    const data = await this.runtimeMonitorService.getRuntimeChains({
      window: query.window || 'today',
      platform: query.platform,
      limit: query.limit,
    });
    return {
      success: true,
      data,
    };
  }

  @Get('runtime-dashboard/chains/:traceId')
  async getChainDetail(@Param('traceId') traceId: string) {
    const data = await this.runtimeMonitorService.getRuntimeChainDetail(traceId);
    return {
      success: true,
      data,
    };
  }
}
