import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  RuntimeClientType,
  RuntimeOutcome,
  RuntimePlatform,
  RuntimeTraceStage,
} from '../runtime-monitor.types';

@Entity('runtime_interface_event')
export class RuntimeInterfaceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_runtime_interface_event_trace_id')
  @Column({ type: 'varchar', length: 96, nullable: true })
  traceId: string | null;

  @Index('IDX_runtime_interface_event_task_id')
  @Column({ type: 'varchar', length: 64, nullable: true })
  taskId: string | null;

  @Index('IDX_runtime_interface_event_platform')
  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  platform: RuntimePlatform;

  @Index('IDX_runtime_interface_event_client_type')
  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  clientType: RuntimeClientType;

  @Index('IDX_runtime_interface_event_stage')
  @Column({ type: 'varchar', length: 16 })
  stage: RuntimeTraceStage;

  @Column({ type: 'varchar', length: 64 })
  interfaceName: string;

  @Column({ type: 'varchar', length: 16 })
  outcome: RuntimeOutcome;

  @Column({ type: 'int', default: 0 })
  latencyMs: number;

  @Column({ type: 'varchar', length: 96, nullable: true })
  errorCode: string | null;

  @Index('IDX_runtime_interface_event_created_at')
  @CreateDateColumn()
  createdAt: Date;
}
