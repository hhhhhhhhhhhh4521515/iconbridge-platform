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
  // People of a partner space (ADR-027), and any address: logs carry ids only.
  'email',
  'phone',
  'firstName',
  'lastName',
  'dhlTrackingNumber',
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

/**
 * Level of the line pino-http writes when a request ends (ADR-028). Successful requests
 * and redirects write none: they are in Application Insights (sampled) and were most of
 * the container logs. Every client and server error is logged.
 */
export function requestLogLevel(
  _req: IncomingMessage,
  res: ServerResponse,
  error?: Error,
): 'error' | 'warn' | 'silent' {
  if (error || res.statusCode >= 500) {
    return 'error';
  }
  return res.statusCode >= 400 ? 'warn' : 'silent';
}

/** Nest's start-up messages (one per module and route at every start of a job or replica). */
const FRAMEWORK_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestFactory',
  'NestApplication',
]);

const WARN = 40;

/**
 * Drops the info lines of Nest's start-up; their warnings and errors are kept (ADR-028).
 * nestjs-pino passes the context as the first argument: `{ context: 'InstanceLoader' }`.
 */
export function isFrameworkNoise(args: unknown[], level: number): boolean {
  const [first] = args;
  return (
    level < WARN &&
    typeof first === 'object' &&
    first !== null &&
    FRAMEWORK_CONTEXTS.has(String((first as { context?: unknown }).context))
  );
}

export function loggerParams(nodeEnv: Env['NODE_ENV']): Params {
  return {
    pinoHttp: {
      level: nodeEnv === 'test' ? 'silent' : 'info',
      customLogLevel: requestLogLevel,
      hooks: {
        logMethod(args, method, level) {
          if (!isFrameworkNoise(args, level)) {
            method.apply(this, args);
          }
        },
      },
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
