import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DouyinBridgeAuthSessionStatus {
  Pending = 'pending',
  Completed = 'completed',
  Expired = 'expired',
}

export const DOUYIN_BRIDGE_AUTH_ACTIVE_KEY = 'active';

@Entity('douyin_bridge_auth_session')
export class DouyinBridgeAuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: DouyinBridgeAuthSessionStatus,
    default: DouyinBridgeAuthSessionStatus.Pending,
  })
  status: DouyinBridgeAuthSessionStatus;

  @Column({ type: 'varchar', length: 64 })
  uploadTokenHash: string;

  @Column({ type: 'varchar', length: 32, unique: true, nullable: true })
  activeKey: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastError: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  initiatedByAdminUserId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  initiatedByAdminEmail: string | null;

  @Column({ type: 'datetime' })
  expireAt: Date;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
