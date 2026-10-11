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

/** Prefix, security headers, cookies and CORS: everything but the logger and the docs. */
export function configureHttp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

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
  // The web app proxies /api/v1 on its own origin, so browsers normally make no
  // cross-origin call. CORS stays limited to the web origin for tools and tests.
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: NestExpressApplication) {
  return SwaggerModule.createDocument(
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
}

/** HTTP configuration shared by the real server (main.ts) and the e2e tests. */
export function setupApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  configureHttp(app);
  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app));
}
