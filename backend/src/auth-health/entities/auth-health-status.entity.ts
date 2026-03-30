import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AuthHealthPlatform = 'bilibili' | 'douyin';
export type AuthHealthState = 'unknown' | 'healthy' | 'degraded' | 'invalid';

@Entity('auth_health_status')
export class AuthHealthStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_auth_health_platform', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  platform: AuthHealthPlatform;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  status: AuthHealthState;

  @Column({ type: 'int', default: 0 })
  consecutiveFailures: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastError: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastSuccessAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastFailureAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

