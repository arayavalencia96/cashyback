import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

import { loadDotEnv, readOptionalEnv } from './common/env';

async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  const defaultCorsOrigins =
    process.env.NODE_ENV === 'production'
      ? ['https://cashy-cd3e6.web.app']
      : ['http://localhost:4200', 'https://cashy-cd3e6.web.app'];
  const corsOrigins =
    readOptionalEnv('CORS_ALLOWED_ORIGINS')
      ?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? defaultCorsOrigins;

  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
  };
  expressApp.set('trust proxy', 1);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  await app.listen(port, '0.0.0.0');
}
void bootstrap();
