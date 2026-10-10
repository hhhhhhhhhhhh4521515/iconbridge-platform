import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_PREFIX, DOCS_PATH } from './app.constants.js';
import { ACCESS_COOKIE } from './auth/auth.constants.js';
import type { Env } from './config/env.js';

export { API_PREFIX, DOCS_PATH };

/** HTTP configuration shared by the real server (main.ts) and the e2e tests. */
export function setupApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Local development runs on plain http://localhost; only production forces HTTPS.
          upgradeInsecureRequests:
            config.get('NODE_ENV', { infer: true }) === 'production' ? [] : null,
        },
      },
    }),
  );
  app.use(cookieParser());

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  // Only the web app may call the API from a browser, with cookies.
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('IconBridge Jobs API')
      .setDescription(
        'Recruitment platform for jobs in Malta, Poland and on cruise ships.\n\n' +
          'Authentication uses httpOnly cookies set by `POST /auth/login`. ' +
          'Errors always have the body `{ code, message, details? }`.',
      )
      .setVersion('0.1.0')
      .addCookieAuth(ACCESS_COOKIE)
      .build(),
  );
  SwaggerModule.setup(DOCS_PATH, app, document);
}
