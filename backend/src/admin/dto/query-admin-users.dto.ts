import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { toOptionalClampedInt } from '../../config/query-transform';

export class QueryAdminUsersDto {
  @IsOptional()
  @Transform(toOptionalClampedInt({ min: 1 }))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(toOptionalClampedInt({ min: 1, max: 100 }))
  @IsInt()
  pageSize?: number;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'USER'])
  role?: 'SUPER_ADMIN' | 'USER';

  @IsOptional()
  @IsIn(['FREE', 'VIP'])
  membershipLevel?: 'FREE' | 'VIP';

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  accountStatus?: 'ACTIVE' | 'DISABLED';
}
