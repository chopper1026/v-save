import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { resolveCorsOrigins, resolvePort } from './config/runtime-config';
import { createGlobalValidationPipe } from './config/validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  // 允许较大的 JSON 请求体（头像 base64 等）
  app.use(
    json({
      limit: '12mb',
    }),
  );
  app.use(
    urlencoded({
      extended: true,
      limit: '12mb',
    }),
  );
  app.useGlobalPipes(createGlobalValidationPipe());

  const corsOrigins = resolveCorsOrigins(process.env.CORS_ORIGINS);

  // 启用 CORS，允许通过环境变量配置
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // 设置全局前缀 /api
  app.setGlobalPrefix('api');

  // 监听端口（可配置）
  const port = resolvePort(process.env.PORT);
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api`);
}
bootstrap();
