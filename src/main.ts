import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

import { loadDotEnv } from './common/env';

async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;

  await app.listen(port, '0.0.0.0');
}
void bootstrap();
