import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentProvider = 'STRIPE';
export type PaymentPlanCode = 'MONTH' | 'QUARTER' | 'YEAR' | 'LIFETIME';
export type PaymentCurrency = 'CNY' | 'USD';
export type PaymentOrderCloseReasonCode =
  | 'RECOVERY_WINDOW_EXPIRED'
  | 'MIGRATION_DUPLICATE_PENDING_ORDER'
  | 'ADMIN_CLOSED';
export type PaymentOrderStatus =
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REFUND_FAILED'
  | 'OPEN'
  | 'CLOSED';

@Entity('payment_orders')
@Index('IDX_payment_orders_user_status_created', ['userId', 'status', 'createdAt'])
export class PaymentOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_payment_orders_order_no', { unique: true })
  @Column({ type: 'varchar', length: 40 })
  orderNo: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 16, default: 'STRIPE' })
  provider: PaymentProvider;

  @Column({ type: 'varchar', length: 16 })
  planCode: PaymentPlanCode;

  @Column({ type: 'varchar', length: 64, default: '' })
  planNameSnapshot: string;

  @Column({ type: 'int', nullable: true })
  durationDays: number | null;

  @Column({ type: 'boolean', default: false })
  isLifetime: boolean;

  @Column({ type: 'varchar', length: 8 })
  preferredCurrency: PaymentCurrency;

  @Column({ type: 'varchar', length: 8 })
  resolvedCurrency: PaymentCurrency;

  @Column({ type: 'int' })
  amountMinor: number;

  @Column({ type: 'varchar', length: 32, default: 'OPEN' })
  status: PaymentOrderStatus;

  @Index('UQ_payment_orders_checkout_session', { unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  stripeCheckoutSessionId: string | null;

  @Index('UQ_payment_orders_payment_intent', { unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  stripePaymentIntentId: string | null;

  @Column({ type: 'varchar', length: 160 })
  receiptEmail: string;

  @Column({ type: 'boolean', default: false })
  invoiceEnabled: boolean;

  @Column({ type: 'varchar', length: 80, nullable: true })
  invoiceName: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  invoiceTaxId: string | null;

  @Column({ type: 'datetime', nullable: true })
  refundWindowEndAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  recoveryWindowEndsAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  closeReasonCode: PaymentOrderCloseReasonCode | null;

  @Index('UQ_payment_orders_recoverable_owner', { unique: true })
  @Column({ type: 'varchar', length: 36, nullable: true })
  recoverableOwnerUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
