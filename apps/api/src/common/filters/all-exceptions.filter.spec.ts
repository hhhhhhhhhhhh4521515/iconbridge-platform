import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { apiErrorSchema } from '@iconbridge/shared';
import type { Env } from '../../config/env.js';
import { AppException } from '../errors/app.exception.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function filterFor(nodeEnv: Env['NODE_ENV']) {
  const filter = new AllExceptionsFilter({ get: () => nodeEnv } as unknown as ConfigService<
    Env,
    true
  >);
  // Silence the expected error log of the unhandled cases.
  vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  return filter;
}

describe('AllExceptionsFilter', () => {
  const filter = filterFor('production');

  it('keeps the code, message and details of an AppException', () => {
    const { status, body } = filter.toResponse(
      new AppException('WEAK_PASSWORD', HttpStatus.BAD_REQUEST, 'Too weak', { score: 1 }),
    );
    expect(status).toBe(400);
    expect(body).toEqual({ code: 'WEAK_PASSWORD', message: 'Too weak', details: { score: 1 } });
  });

  it.each([
    [new BadRequestException('Malformed JSON'), 400, 'VALIDATION_ERROR'],
    [new NotFoundException('Cannot GET /nowhere'), 404, 'NOT_FOUND'],
    [new ThrottlerException(), 429, 'RATE_LIMITED'],
  ])('maps a framework exception to a code', (exception, status, code) => {
    const response = filter.toResponse(exception);
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
  });

  it('maps Prisma unique and not-found errors', () => {
    const prismaError = (code: string) =>
      Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
        name: 'PrismaClientKnownRequestError',
        code,
      });
    expect(filter.toResponse(prismaError('P2002'))).toMatchObject({
      status: 409,
      body: { code: 'CONFLICT' },
    });
    expect(filter.toResponse(prismaError('P2025'))).toMatchObject({
      status: 404,
      body: { code: 'NOT_FOUND' },
    });
    expect(filter.toResponse(prismaError('P2002')).body.message).not.toContain('email');
  });

  it('hides the message and the stack of an unexpected error in production', () => {
    const { status, body } = filter.toResponse(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
    );
    expect(status).toBe(500);
    expect(body).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('hides the message of a 5xx HttpException too', () => {
    const { status, body } = filter.toResponse(new InternalServerErrorException('internal detail'));
    expect(status).toBe(500);
    expect(body).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  it('handles values that are not errors', () => {
    expect(filter.toResponse('boom').body.code).toBe('INTERNAL_ERROR');
  });

  it('adds the stack in development only', () => {
    expect(filterFor('development').toResponse(new Error('x')).body.details).toHaveProperty(
      'stack',
    );
    expect(filterFor('test').toResponse(new Error('x')).body.details).toBeUndefined();
  });
});
