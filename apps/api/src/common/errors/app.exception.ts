import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode } from '@iconbridge/shared';

/**
 * Error with a machine-readable code. The exception filter turns it into
 * `{ code, message, details }`. Messages are in English and must not contain personal data.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    status: HttpStatus,
    message: string,
    readonly details?: unknown,
    /** Extra top-level fields of the response body, e.g. `nextAllowedAt` for REAPPLY_COOLDOWN. */
    readonly extra?: Readonly<Record<string, string>>,
  ) {
    super(message, status);
  }
}

export const unauthenticated = (message = 'Authentication is required') =>
  new AppException('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, message);

export const forbidden = (message = 'You are not allowed to do this') =>
  new AppException('FORBIDDEN', HttpStatus.FORBIDDEN, message);

export const notFound = (message = 'Resource not found') =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, message);
