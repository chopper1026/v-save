import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('kuaishou_auth_session')
export class KuaishouAuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true, default: 'kuaishou' })
  platform: string;

  @Column({ type: 'longtext' })
  cookie: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastError: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastCheckAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
