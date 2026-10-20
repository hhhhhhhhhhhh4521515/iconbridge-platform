import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { ConfigService } from '@nestjs/config';
import type { ApiError, ApiErrorCode } from '@iconbridge/shared';
import type { Response } from 'express';
import type { Env } from '../../config/env.js';
import { AppException } from '../errors/app.exception.js';

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  429: 'RATE_LIMITED',
};

const GENERIC_MESSAGE: Partial<Record<number, string>> = {
  413: 'The file is too large',
  429: 'Too many requests. Try again later.',
};

/** Prisma error codes that mean something to a client. */
const PRISMA_ERRORS: Partial<
  Record<string, { status: number; code: ApiErrorCode; message: string }>
> = {
  P2002: { status: 409, code: 'CONFLICT', message: 'This value is already used' },
  P2025: { status: 404, code: 'NOT_FOUND', message: 'Resource not found' },
};

function prismaErrorCode(exception: unknown): string | undefined {
  if (
    exception instanceof Error &&
    exception.name === 'PrismaClientKnownRequestError' &&
    'code' in exception &&
    typeof exception.code === 'string'
  ) {
    return exception.code;
  }
  return undefined;
}

/**
 * Every error leaves the API as `{ code, message, details? }`.
 * Unexpected errors are logged with their stack and answered with a generic
 * message; the stack is added to the response in development only.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly exposeStack: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.exposeStack = config.get('NODE_ENV', { infer: true }) === 'development';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    response.status(status).json(body);
  }

  toResponse(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        body: {
          code: exception.code,
          message: exception.message,
          ...(exception.details === undefined ? {} : { details: exception.details }),
          ...exception.extra,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status < 500) {
        return {
          status,
          body: {
            code: CODE_BY_STATUS[status] ?? 'VALIDATION_ERROR',
            message: GENERIC_MESSAGE[status] ?? exception.message,
          },
        };
      }
    }

    const prismaError = PRISMA_ERRORS[prismaErrorCode(exception) ?? ''];
    if (prismaError) {
      return {
        status: prismaError.status,
        body: { code: prismaError.code, message: prismaError.message },
      };
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const stack = exception instanceof Error ? exception.stack : undefined;
    const name = exception instanceof Error ? exception.name : typeof exception;
    this.logger.error(`Unhandled ${name}`, stack);
    // Application Insights (exceptions table): the type and the stack, not the message,
    // which could quote data, as in the log line above.
    const span = trace.getActiveSpan();
    span?.recordException({ name, message: name, ...(stack ? { stack } : {}) });
    span?.setStatus({ code: SpanStatusCode.ERROR, message: name });
    return {
      status,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        ...(this.exposeStack && stack ? { details: { stack } } : {}),
      },
    };
  }
}
