import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { QueryAdminAuditDto } from './dto/query-admin-audit.dto';
import { QueryAdminUsersDto } from './dto/query-admin-users.dto';
import { UpdateUserMembershipDto } from './dto/update-user-membership.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { AdminUsersService } from './admin-users.service';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    role: 'SUPER_ADMIN' | 'USER';
  };
}

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  async listUsers(@Query() query: QueryAdminUsersDto) {
    const result = await this.adminUsersService.queryUsers(query);
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

  @Get('audit')
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

  @Patch(':id/role')
  async updateRole(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    const userId = req.user?.id || '';
    const updated = await this.adminUsersService.updateRole(userId, id, body);
    return {
      success: true,
      data: updated,
    };
  }

  @Patch(':id/membership')
  async updateMembership(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: UpdateUserMembershipDto,
  ) {
    const userId = req.user?.id || '';
    const updated = await this.adminUsersService.updateMembership(
      userId,
      id,
      body,
    );
    return {
      success: true,
      data: updated,
    };
  }

  @Patch(':id/status')
  async updateStatus(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: UpdateUserStatusDto,
  ) {
    const userId = req.user?.id || '';
    const updated = await this.adminUsersService.updateStatus(userId, id, body);
    return {
      success: true,
      data: updated,
    };
  }
}

