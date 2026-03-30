import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  RuntimeClientType,
  RuntimeFeature,
  RuntimeOutcome,
  RuntimePlatform,
} from '../runtime-monitor.types';

@Entity('runtime_feature_event')
export class RuntimeFeatureEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_runtime_feature_event_feature')
  @Column({ type: 'varchar', length: 16 })
  feature: RuntimeFeature;

  @Index('IDX_runtime_feature_event_client_type')
  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  clientType: RuntimeClientType;

  @Index('IDX_runtime_feature_event_platform')
  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  platform: RuntimePlatform;

  @Column({ type: 'varchar', length: 16 })
  outcome: RuntimeOutcome;

  @Column({ type: 'int', default: 0 })
  latencyMs: number;

  @Column({ type: 'varchar', length: 96, nullable: true })
  errorCode: string | null;

  @Index('IDX_runtime_feature_event_trace_id')
  @Column({ type: 'varchar', length: 96, nullable: true })
  traceId: string | null;

  @Index('UQ_runtime_feature_event_event_key', { unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  eventKey: string | null;

  @Column({ type: 'int', nullable: true })
  candidateCount: number | null;

  @Column({ type: 'int', nullable: true })
  selectedCandidateIndex: number | null;

  @Column({ type: 'int', nullable: true })
  failoverCount: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  selectedCandidateKind: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  selectedQuality: string | null;

  @Index('IDX_runtime_feature_event_created_at')
  @CreateDateColumn()
  createdAt: Date;
}
