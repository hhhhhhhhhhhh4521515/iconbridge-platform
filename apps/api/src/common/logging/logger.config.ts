import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { trace } from '@opentelemetry/api';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.js';

export const REQUEST_ID_HEADER = 'x-request-id';

const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'passwordHash',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'turnstileToken',
  'passportNumber',
  'passportNumberEncrypted',
  'cookie',
  'authorization',
];

/**
 * Paths removed from every log line. pino matches exact paths, so each sensitive
 * key is listed at the root and one and two levels down, plus the HTTP headers
 * that carry credentials.
 */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

export const REDACTED = '[REDACTED]';

/** A caller-supplied id is kept only if it is short and harmless to log. */
export function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : randomUUID();
}

export function loggerParams(nodeEnv: Env['NODE_ENV']): Params {
  return {
    pinoHttp: {
      level: nodeEnv === 'test' ? 'silent' : 'info',
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id = requestIdFrom(req.headers[REQUEST_ID_HEADER]);
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      // The query string can carry tokens; log the path only.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      // Joins a log line to its request in Application Insights (operation id).
      mixin: () => {
        const context = trace.getActiveSpan()?.spanContext();
        return context ? { traceId: context.traceId, spanId: context.spanId } : {};
      },
      customProps: (req: IncomingMessage) => ({
        userId: (req as IncomingMessage & { user?: { id: string } }).user?.id,
      }),
      autoLogging: { ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false },
      ...(nodeEnv === 'development'
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
    },
  };
}
