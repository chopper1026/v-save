import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { QueryAdminAuditDto } from './dto/query-admin-audit.dto';
import { AdminUsersService } from './admin-users.service';

@Controller('admin/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminAuditController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  async listAudit(@Query() query: QueryAdminAuditDto) {
    const result = await this.adminUsersService.queryAuditLogs(query);
    return {
      success: true,
      data: result.items,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }
}
