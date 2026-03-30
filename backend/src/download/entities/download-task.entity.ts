import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DownloadTaskStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'expired';

/**
 * 异步下载任务实体
 */
@Entity('download_tasks')
export class DownloadTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column('text')
  sourceUrl: string;

  @Column()
  platform: string;

  @Column('text')
  title: string;

  @Column({ default: 'mp4' })
  format: string;

  @Column({ default: '720p' })
  quality: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  downloadHistoryId: string | null;

  @Column({ type: 'varchar', length: 96, nullable: true })
  runtimeTraceId: string | null;

  @Column({ default: 'queued' })
  status: DownloadTaskStatus;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column('text', { nullable: true })
  message: string | null;

  @Column('text', { nullable: true })
  outputPath: string | null;

  @Column({ nullable: true })
  fileExtension: string | null;

  @Column('text', { nullable: true })
  downloadUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
