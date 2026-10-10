import { Body, HttpStatus, Param, PipeTransform, Query } from '@nestjs/common';
import type { ValidationIssue } from '@iconbridge/shared';
import type { z } from 'zod';
import { AppException } from '../errors/app.exception.js';

/**
 * Validates and normalises one request part with a zod schema (usually from
 * packages/shared). The handler receives the parsed output, so unknown fields are
 * gone and defaults are applied. Issues never echo the submitted value.
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details: ValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new AppException(
        'VALIDATION_ERROR',
        HttpStatus.BAD_REQUEST,
        'The request is invalid',
        details,
      );
    }
    return result.data;
  }
}

export const ZodBody = (schema: z.ZodType) => Body(new ZodValidationPipe(schema));
export const ZodQuery = (schema: z.ZodType) => Query(new ZodValidationPipe(schema));
export const ZodParams = (schema: z.ZodType) => Param(new ZodValidationPipe(schema));
