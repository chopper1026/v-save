import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { toOptionalClampedInt } from '../../config/query-transform';

export class QueryAdminAuditDto {
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
  targetUserId?: string;

  @IsOptional()
  @IsString()
  adminUserId?: string;

  @IsOptional()
  @IsIn(['USER', 'ROLE', 'AUTH', 'DOWNLOAD_POLICY'])
  module?: 'USER' | 'ROLE' | 'AUTH' | 'DOWNLOAD_POLICY';

  @IsOptional()
  @IsIn(['BILIBILI', 'DOUYIN', 'NONE'])
  platform?: 'BILIBILI' | 'DOUYIN' | 'NONE';

  @IsOptional()
  @IsString()
  keyword?: string;
}
