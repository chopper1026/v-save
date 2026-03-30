import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Public } from '../auth/public.decorator';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { QueryPaymentOrdersDto } from './dto/query-payment-orders.dto';
import { RequestRefundDto } from './dto/request-refund.dto';
import { ReconcileDailyDto } from './dto/reconcile-daily.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('orders')
  async createOrder(
    @Request() req,
    @Body() dto: CreatePaymentOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const data = await this.paymentsService.createOrder({
      userId: req.user.id,
      dto,
      idempotencyKey: String(idempotencyKey || '').trim(),
    });

    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderNo/recheckout')
  async recheckoutOrder(
    @Request() req,
    @Param('orderNo') orderNo: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const data = await this.paymentsService.recheckoutPendingOrder({
      userId: req.user.id,
      orderNo,
      idempotencyKey: String(idempotencyKey || '').trim(),
    });

    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders/:orderNo')
  async getOrder(@Request() req, @Param('orderNo') orderNo: string) {
    const data = await this.paymentsService.getOrderForUser({
      userId: req.user.id,
      orderNo,
    });

    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders')
  async listOrders(@Request() req, @Query() query: QueryPaymentOrdersDto) {
    const result = await this.paymentsService.listOrdersForUser({
      userId: req.user.id,
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

  @UseGuards(JwtAuthGuard)
  @Get('subscription-status')
  async getSubscriptionStatus(@Request() req) {
    const data = await this.paymentsService.getSubscriptionStatus(req.user.id);
    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderNo/refund-request')
  async requestRefund(
    @Request() req,
    @Param('orderNo') orderNo: string,
    @Body() dto: RequestRefundDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const data = await this.paymentsService.requestRefund({
      userId: req.user.id,
      orderNo,
      dto,
      idempotencyKey: String(idempotencyKey || '').trim(),
    });

    return {
      success: true,
      data,
    };
  }

  @Public()
  @Post('webhooks/stripe')
  async stripeWebhook(
    @Req() req: ExpressRequest,
    @Headers('stripe-signature') signature?: string,
  ) {
    const body = req.body;
    const rawBodyBuffer = Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}));

    const data = await this.paymentsService.handleStripeWebhook({
      rawBody: rawBodyBuffer,
      signature: String(signature || '').trim(),
    });

    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('reconciliation/daily')
  async getDailyReconciliation(@Request() req, @Query() dto: ReconcileDailyDto) {
    const data = await this.paymentsService.runDailyReconciliation({
      operatorUserId: req.user.id,
      dto,
    });

    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('orders/:orderNo/manual-repair')
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
