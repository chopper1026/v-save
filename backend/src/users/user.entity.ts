import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'SUPER_ADMIN' | 'USER';
export type MembershipLevel = 'FREE' | 'VIP';
export type AccountStatus = 'ACTIVE' | 'DISABLED';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ default: '新用户' })
  nickname: string;

  @Column({ type: 'varchar', length: 32, default: 'USER' })
  role: UserRole;

  @Column({ type: 'varchar', length: 16, default: 'FREE' })
  membershipLevel: MembershipLevel;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  accountStatus: AccountStatus;

  @Column('text', { nullable: true })
  avatar: string | null;

  @Column({ unique: true, nullable: true })
  phone: string | null;

  @Column({ nullable: true })
  vipExpireDate: Date | null;

  @Column({ default: 0 })
  downloadCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
