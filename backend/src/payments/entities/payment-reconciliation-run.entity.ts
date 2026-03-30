import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentReconciliationStatus = 'RUNNING' | 'DONE' | 'FAILED';

@Entity('payment_reconciliation_runs')
@Index('UQ_payment_reconciliation_biz_date', ['bizDate'], { unique: true })
export class PaymentReconciliationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  bizDate: string;

  @Column({ type: 'varchar', length: 16, default: 'RUNNING' })
  status: PaymentReconciliationStatus;

  @Column({ type: 'int', default: 0 })
  platformOrderCount: number;

  @Column({ type: 'int', default: 0 })
  localPaidOrderCount: number;

  @Column({ type: 'int', default: 0 })
  diffCount: number;

  @Column({ type: 'simple-json', nullable: true })
  reportJson: Record<string, any> | null;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
