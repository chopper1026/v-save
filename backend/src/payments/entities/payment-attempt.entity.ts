import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentProvider } from './payment-order.entity';

export type PaymentAttemptStatus = 'OPEN' | 'EXPIRED' | 'PAID' | 'FAILED';
export type PaymentAttemptReasonCode =
  | 'SESSION_EXPIRED'
  | 'ABANDONED_BY_USER'
  | 'EXPIRED_REPLACED'
  | 'PROVIDER_FAILED';
export type PaymentAttemptCreatedByAction =
  | 'CREATE_ORDER'
  | 'RECHECKOUT'
  | 'LEGACY_BACKFILL';

@Entity('payment_attempts')
@Index('IDX_payment_attempts_order_created', ['orderId', 'createdAt'])
@Index('IDX_payment_attempts_order_status_created', ['orderId', 'status', 'createdAt'])
export class PaymentAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_payment_attempts_attempt_no', { unique: true })
  @Column({ type: 'varchar', length: 40 })
  attemptNo: string;

  @Column({ type: 'varchar', length: 36 })
  orderId: string;

  @Column({ type: 'varchar', length: 16, default: 'STRIPE' })
  provider: PaymentProvider;

  @Column({ type: 'varchar', length: 32, default: 'OPEN' })
  status: PaymentAttemptStatus;

  @Index('UQ_payment_attempts_provider_session', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  providerSessionId: string;

  @Index('UQ_payment_attempts_payment_intent', { unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  paymentIntentId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  checkoutUrl: string | null;

  @Column({ type: 'varchar', length: 32, default: 'CREATE_ORDER' })
  createdByAction: PaymentAttemptCreatedByAction;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reasonCode: PaymentAttemptReasonCode | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  failureReason: string | null;

  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  @Index('UQ_payment_attempts_open_order', { unique: true })
  @Column({ type: 'varchar', length: 36, nullable: true })
  openAttemptOrderId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
