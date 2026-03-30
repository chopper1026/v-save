import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentRefundStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PENDING_PROVIDER'
  | 'SUCCEEDED'
  | 'FAILED';

export type PaymentRefundRequester = 'USER' | 'ADMIN';

@Entity('payment_refunds')
@Index('UQ_payment_refunds_refund_no', ['refundNo'], { unique: true })
@Index('UQ_payment_refunds_provider_refund', ['stripeRefundId'], { unique: true })
@Index('UQ_payment_refunds_order_idempotency', ['orderId', 'idempotencyKey'], {
  unique: true,
})
@Index('IDX_payment_refunds_user_status', ['userId', 'status'])
export class PaymentRefund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  refundNo: string;

  @Column({ type: 'varchar', length: 36 })
  orderId: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 24, default: 'REQUESTED' })
  status: PaymentRefundStatus;

  @Column({ type: 'int' })
  amountMinor: number;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ type: 'varchar', length: 200 })
  reason: string;

  @Column({ type: 'varchar', length: 16, default: 'USER' })
  requestedByType: PaymentRefundRequester;

  @Column({ type: 'varchar', length: 36 })
  requestedByUserId: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  stripeRefundId: string | null;

  @Column({ type: 'varchar', length: 80 })
  idempotencyKey: string;

  @Column({ type: 'datetime' })
  requestedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  failureCode: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  failureMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
