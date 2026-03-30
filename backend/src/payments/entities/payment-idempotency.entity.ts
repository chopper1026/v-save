import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('payment_idempotency_records')
@Index('UQ_payment_idempotency_owner_scope_key', ['ownerUserId', 'scope', 'idempotencyKey'], {
  unique: true,
})
export class PaymentIdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  ownerUserId: string;

  @Column({ type: 'varchar', length: 80 })
  scope: string;

  @Column({ type: 'varchar', length: 120 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ type: 'simple-json' })
  responseJson: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
