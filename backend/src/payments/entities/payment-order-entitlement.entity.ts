import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentEntitlementStatus = 'ACTIVE' | 'REVOKED';
export type PaymentPlanCode = 'MONTH' | 'QUARTER' | 'YEAR' | 'LIFETIME';

@Entity('payment_order_entitlements')
@Index('IDX_payment_entitlements_user_status_end', ['userId', 'status', 'effectiveEndAt'])
export class PaymentOrderEntitlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_payment_entitlements_order', { unique: true })
  @Column({ type: 'varchar', length: 36 })
  orderId: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  planCode: PaymentPlanCode;

  @Column({ type: 'boolean', default: false })
  isLifetime: boolean;

  @Column({ type: 'int', nullable: true })
  grantDays: number | null;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status: PaymentEntitlementStatus;

  @Column({ type: 'datetime', nullable: true })
  effectiveStartAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  effectiveEndAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  revokedReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
