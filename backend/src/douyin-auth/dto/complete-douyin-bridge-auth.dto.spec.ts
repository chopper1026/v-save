import { validate } from 'class-validator';
import { CompleteDouyinBridgeAuthDto } from './complete-douyin-bridge-auth.dto';

describe('CompleteDouyinBridgeAuthDto', () => {
  it('rejects whitespace-only authSessionId, uploadToken, and cookieHeader', async () => {
    const dto = new CompleteDouyinBridgeAuthDto();
    dto.authSessionId = '   ';
    dto.uploadToken = '   ';
    dto.cookieHeader = '   ';

    const errors = await validate(dto);
    const propertyNames = errors.map((error) => error.property);

    expect(propertyNames).toEqual(
      expect.arrayContaining(['authSessionId', 'uploadToken', 'cookieHeader']),
    );
  });
});
