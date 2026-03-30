import {
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
  };
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @Request() req: RequestWithUser,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const userId = req.user?.id || '';
    const result = await this.notificationsService.queryForUser({
      userId,
      unreadOnly: unreadOnly === '1' || unreadOnly === 'true',
      type: type?.trim(),
      page: Number.parseInt(page || '1', 10),
      pageSize: Number.parseInt(pageSize || '20', 10),
    });

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

  @Get('unread-count')
  async unreadCount(@Request() req: RequestWithUser) {
    const userId = req.user?.id || '';
    const count = await this.notificationsService.getUnreadCount(userId);
    return {
      success: true,
      data: {
        count,
      },
    };
  }

  @Patch(':id/read')
  async readOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    const userId = req.user?.id || '';
    const updated = await this.notificationsService.markAsRead(userId, id);
    return {
      success: true,
      data: {
        updated,
      },
    };
  }

  @Patch('read-all')
  async readAll(@Request() req: RequestWithUser) {
    const userId = req.user?.id || '';
    const affected = await this.notificationsService.markAllAsRead(userId);
    return {
      success: true,
      data: {
        affected,
      },
    };
  }

  @Delete('clear')
  async clearAll(@Request() req: RequestWithUser) {
    const userId = req.user?.id || '';
    const affected = await this.notificationsService.clearAllForUser(userId);
    return {
      success: true,
      data: {
        affected,
      },
    };
  }
}
