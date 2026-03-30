import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentWebhookProcessStatus =
  | 'PENDING'
  | 'PROCESSED'
  | 'IGNORED'
  | 'FAILED';

@Entity('payment_webhook_events')
@Index('UQ_payment_webhooks_provider_event', ['provider', 'eventId'], {
  unique: true,
})
@Index('IDX_payment_webhooks_status_received', ['processStatus', 'receivedAt'])
export class PaymentWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, default: 'STRIPE' })
  provider: string;

  @Column({ type: 'varchar', length: 128 })
  eventId: string;

  @Column({ type: 'varchar', length: 80 })
  eventType: string;

  @Column({ type: 'boolean', default: false })
  signatureVerified: boolean;

  @Column({ type: 'simple-json' })
  payloadJson: Record<string, any>;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  processStatus: PaymentWebhookProcessStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  errorMessage: string | null;

  @Column({ type: 'datetime' })
  receivedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
