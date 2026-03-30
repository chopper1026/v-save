import {
  IsIn,
  IsOptional,
} from 'class-validator';

export const PAYMENT_PLAN_CODES = ['MONTH', 'QUARTER', 'YEAR'] as const;
export type PaymentPlanCode = (typeof PAYMENT_PLAN_CODES)[number] | 'LIFETIME';

export const PAYMENT_CURRENCIES = ['CNY', 'USD'] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];

export class CreatePaymentOrderDto {
  @IsIn(PAYMENT_PLAN_CODES)
  planCode: Exclude<PaymentPlanCode, 'LIFETIME'>;

  @IsOptional()
  @IsIn(PAYMENT_CURRENCIES)
  preferredCurrency?: PaymentCurrency;

  @IsIn(['WEB'])
  clientType: 'WEB';
}
