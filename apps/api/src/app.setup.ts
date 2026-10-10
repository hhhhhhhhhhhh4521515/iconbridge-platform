import { INestApplication, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Env } from './config/env.js';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'api/docs';

/** HTTP configuration shared by the real server (main.ts) and the e2e tests. */
export function setupApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('IconBridge Jobs API')
      .setDescription('Recruitment platform for jobs in Malta, Poland and on cruise ships')
      .setVersion('0.1.0')
      .build(),
  );
  SwaggerModule.setup(DOCS_PATH, app, document);
}
