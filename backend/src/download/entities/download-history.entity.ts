import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { User } from '../../users/user.entity';

/**
 * 下载历史实体
 */
@Entity('download_history')
export class DownloadHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  videoTitle: string;

  @Column('text')
  videoUrl: string;

  @Column('text', { nullable: true })
  sourceUrl: string | null;

  @Column()
  platform: string;

  @Column('text', { nullable: true })
  coverUrl: string;

  @Column({ nullable: true })
  format: string;

  @Column({ nullable: true })
  quality: string;

  @Column('text', { nullable: true })
  downloadUrl: string;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'datetime', nullable: true })
  hiddenAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  user: User;

  @Column({ nullable: true })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;
}
