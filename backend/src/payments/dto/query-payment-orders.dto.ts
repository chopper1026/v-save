import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryPaymentOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;

  @IsOptional()
  @IsIn([
    'OPEN',
    'PAID',
    'REFUND_PENDING',
    'REFUNDED',
    'REFUND_FAILED',
    'CLOSED',
    'CREATED',
    'PENDING_PAYMENT',
    'EXPIRED',
    'CANCELED',
  ])
  status?:
    | 'OPEN'
    | 'PAID'
    | 'REFUND_PENDING'
    | 'REFUNDED'
    | 'REFUND_FAILED'
    | 'CLOSED'
    | 'CREATED'
    | 'PENDING_PAYMENT'
    | 'EXPIRED'
    | 'CANCELED';
}
