import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { QueryAdminPaymentOrdersDto } from './dto/query-admin-payment-orders.dto';
import { ReconcileDailyDto } from './dto/reconcile-daily.dto';
import { PaymentsService } from './payments.service';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminPaymentOrdersController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  async listOrders(@Query() query: QueryAdminPaymentOrdersDto) {
    const result = await this.paymentsService.listOrdersForAdmin({
      query,
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

  @Get(':orderNo')
  async getOrder(@Param('orderNo') orderNo: string) {
    const data = await this.paymentsService.getOrderForAdmin({
      orderNo,
    });

    return {
      success: true,
      data,
    };
  }

  @Post('reconciliation')
  async runReconciliation(@Request() req, @Body() dto: ReconcileDailyDto) {
    const data = await this.paymentsService.runDailyReconciliation({
      operatorUserId: req.user.id,
      dto,
    });

    return {
      success: true,
      data,
    };
  }

  @Post(':orderNo/manual-repair')
  async manualRepairOrder(@Request() req, @Param('orderNo') orderNo: string) {
    const data = await this.paymentsService.manualRepairOrder({
      orderNo,
      operatorUserId: req.user.id,
    });

    return {
      success: true,
      data,
    };
  }
}
