import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AdminAuditModule = 'USER' | 'ROLE' | 'AUTH' | 'DOWNLOAD_POLICY';
export type AdminAuditPlatform = 'BILIBILI' | 'DOUYIN' | 'NONE';
export type AdminAuditTargetType = 'USER' | 'AUTH_SESSION' | 'SYSTEM';

@Entity('user_admin_audit_logs')
@Index('IDX_user_admin_audit_target_created', ['targetUserId', 'createdAt'])
@Index('IDX_user_admin_audit_admin_created', ['adminUserId', 'createdAt'])
export class UserAdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  adminUserId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  adminEmail: string | null;

  @Column({ type: 'varchar', length: 36 })
  targetUserId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  targetEmail: string | null;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'varchar', length: 16, default: 'USER' })
  module: AdminAuditModule;

  @Column({ type: 'varchar', length: 16, default: 'NONE' })
  platform: AdminAuditPlatform;

  @Column({ type: 'varchar', length: 32, default: 'USER' })
  targetType: AdminAuditTargetType;

  @Column({ type: 'simple-json', nullable: true })
  beforeState: Record<string, any> | null;

  @Column({ type: 'simple-json', nullable: true })
  afterState: Record<string, any> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
