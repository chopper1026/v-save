import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  DownloadClientType,
  DownloadModePlatform,
  DownloadPolicyMode,
} from '../download-mode.types';

@Entity('download_mode_configs')
@Index('IDX_download_mode_platform_client', ['platform', 'clientType'], {
  unique: true,
})
export class DownloadModeConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  platform: DownloadModePlatform;

  @Column({ type: 'varchar', length: 16 })
  clientType: DownloadClientType;

  @Column({ type: 'varchar', length: 32 })
  mode: DownloadPolicyMode;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedByUserId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updatedByEmail: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
