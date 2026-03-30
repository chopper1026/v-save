import type { ConfigService } from '@nestjs/config';

const MIN_JWT_SECRET_LENGTH = 24;
const INSECURE_JWT_SECRETS = new Set([
  'v-save-secret-key',
  'your-super-secret-jwt-key-change-in-production',
  'replace-with-a-local-dev-secret',
  'replace-with-a-real-secret',
]);

export const readJwtSecret = (
  configService: Pick<ConfigService, 'get'>,
): string => {
  const secret = String(configService.get<string>('JWT_SECRET') || '').trim();

  if (!secret) {
    throw new Error('JWT_SECRET 未配置，请在环境变量或 .env 中设置强随机值');
  }

  if (INSECURE_JWT_SECRETS.has(secret)) {
    throw new Error('JWT_SECRET 不能使用公开默认值，请替换为强随机值');
  }

  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET 长度不足，至少需要 ${MIN_JWT_SECRET_LENGTH} 个字符`,
    );
  }

  return secret;
};
