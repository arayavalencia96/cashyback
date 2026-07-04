import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

import { loadDotEnv } from './common/env';

async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
