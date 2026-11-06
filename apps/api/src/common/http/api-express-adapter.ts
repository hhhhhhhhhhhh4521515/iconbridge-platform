import { ExpressAdapter } from '@nestjs/platform-express';

/**
 * Nest turns a body parser SyntaxError into `new BadRequestException(error.message)`: the
 * message quotes the body and the parser's `type` is lost. Parser errors (`http-errors`, with
 * `type` and a 4xx `status`) pass through unchanged instead, so `AllExceptionsFilter` answers
 * them with a fixed message, like a body over the limit (audit M1).
 */
export class ApiExpressAdapter extends ExpressAdapter {
  override mapException(error: unknown): unknown {
    if (
      error instanceof Error &&
      'type' in error &&
      'status' in error &&
      typeof error.status === 'number' &&
      error.status >= 400 &&
      error.status < 500
    ) {
      return error;
    }
    return super.mapException(error);
  }
}
