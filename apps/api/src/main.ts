import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { DOCS_PATH, setupApp } from './app.setup.js';
import type { Env } from './config/env.js';
import { PrismaService } from './prisma/prisma.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  setupApp(app);

  const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true });
  await app.listen(port);
  app.get(Logger).log(`API on http://localhost:${port} (docs: /${DOCS_PATH})`, 'Bootstrap');
  // The first database connection (TLS and authentication with PostgreSQL in Azure) is
  // opened now, in the background, rather than by the readiness probe or the first
  // request after a cold start (docs/adr/ADR-017-cold-start.md).
  void app.get(PrismaService).$queryRaw`SELECT 1`.catch((error: unknown) => {
    app
      .get(Logger)
      .warn(
        `Database warm-up failed: ${error instanceof Error ? error.name : 'unknown'}`,
        'Bootstrap',
      );
  });
}

await bootstrap();
