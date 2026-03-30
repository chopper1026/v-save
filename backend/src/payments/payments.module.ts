import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminUsersModule } from '../admin/admin-users.module';
import { DownloadModule } from '../download/download.module';
import { User } from '../users/user.entity';
import { AdminPaymentOrdersController } from './admin-payment-orders.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentOrder } from './entities/payment-order.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { PaymentIdempotencyRecord } from './entities/payment-idempotency.entity';
import { PaymentOrderEntitlement } from './entities/payment-order-entitlement.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { PaymentRefund } from './entities/payment-refund.entity';
import { PaymentReconciliationRun } from './entities/payment-reconciliation-run.entity';
import { StripeProvider } from './providers/stripe.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentOrder,
      PaymentAttempt,
      PaymentIdempotencyRecord,
      PaymentOrderEntitlement,
      PaymentWebhookEvent,
      PaymentRefund,
      PaymentReconciliationRun,
      User,
    ]),
    UsersModule,
    NotificationsModule,
    AdminUsersModule,
    DownloadModule,
  ],
  controllers: [PaymentsController, AdminPaymentOrdersController],
  providers: [PaymentsService, StripeProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
