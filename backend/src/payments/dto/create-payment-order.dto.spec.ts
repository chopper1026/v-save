import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreatePaymentOrderDto } from './create-payment-order.dto';

describe('CreatePaymentOrderDto', () => {
  it('accepts payload without invoice fields', async () => {
    const dto = new CreatePaymentOrderDto();
    dto.planCode = 'MONTH';
    dto.preferredCurrency = 'CNY';
    dto.clientType = 'WEB';

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
