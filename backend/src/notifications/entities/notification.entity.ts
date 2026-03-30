import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('notifications')
@Index('IDX_notifications_user_read_created', ['userId', 'isRead', 'createdAt'])
@Index('IDX_notifications_created', ['createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'varchar', length: 16, default: 'info' })
  level: string;

  @Column({ type: 'varchar', length: 32, default: 'system' })
  source: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'simple-json', nullable: true })
  payload: Record<string, any> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actionUrl: string | null;

  @Index('UQ_notifications_dedup', { unique: true })
  @Column({ type: 'varchar', length: 191, nullable: true })
  dedupKey: string | null;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'datetime', nullable: true })
  readAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

