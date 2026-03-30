import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { toOptionalClampedInt } from '../../config/query-transform';

export class QueryAdminPaymentOrdersDto {
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
  @IsIn(['OPEN', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED', 'CLOSED'])
  status?: 'OPEN' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'CLOSED';

  @IsOptional()
  @IsIn(['MONTH', 'QUARTER', 'YEAR', 'LIFETIME'])
  planCode?: 'MONTH' | 'QUARTER' | 'YEAR' | 'LIFETIME';

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;
}
