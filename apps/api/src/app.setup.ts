import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_PREFIX, DOCS_PATH } from './app.constants.js';
import { ACCESS_COOKIE } from './auth/auth.constants.js';
import { originCheck } from './common/http/origin-check.js';
import { addAccessExtensions } from './common/swagger/access-extension.js';
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
  const webOrigins = [
    config.get('WEB_ORIGIN', { infer: true }),
    ...config.get('WEB_ORIGIN_ALIASES', { infer: true }),
  ];
  // State-changing requests started by a page of another site are refused (CSRF).
  app.use(originCheck(webOrigins));

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  // The web app proxies /api/v1 on its own origin, so browsers normally make no
  // cross-origin call. CORS stays limited to the web origins for tools and tests.
  app.enableCors({ origin: webOrigins, credentials: true });
  app.enableShutdownHooks();

  // The web app and the Azure ingress keep their connections to the API open and use
  // them again. Node closes an idle connection after 5 seconds by default: a request
  // sent at that very moment is lost ("socket hang up"). Idle connections are kept
  // longer than the clients keep them, so it is the client that closes.
  const server = app.getHttpServer() as { keepAliveTimeout: number; headersTimeout: number };
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1_000;
}

export function buildOpenApiDocument(app: NestExpressApplication) {
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
  return addAccessExtensions(app, document);
}

/** Idle time before the API closes a kept-alive connection. */
export const KEEP_ALIVE_MS = 65_000;

/** HTTP configuration shared by the real server (main.ts) and the e2e tests. */
export function setupApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  configureHttp(app);
  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app));
}
