import { readJwtSecret } from './jwt-secret';

describe('readJwtSecret', () => {
  it('throws when JWT_SECRET is missing', () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    expect(() => readJwtSecret(configService as any)).toThrow(
      'JWT_SECRET 未配置',
    );
  });

  it('rejects placeholder JWT secrets', () => {
    const configService = {
      get: jest.fn().mockReturnValue('v-save-secret-key'),
    };

    expect(() => readJwtSecret(configService as any)).toThrow(
      'JWT_SECRET 不能使用公开默认值',
    );
  });
});
