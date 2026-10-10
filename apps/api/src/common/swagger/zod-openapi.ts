import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import { apiErrorSchema } from '@iconbridge/shared';
import { z } from 'zod';

type OpenApiSchema = Extract<Parameters<typeof ApiBody>[0], { schema: unknown }>['schema'];

/** OpenAPI 3.0 schema generated from a zod schema, so the docs cannot drift from validation. */
export function openApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): OpenApiSchema {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as OpenApiSchema;
}

export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: openApiSchema(schema) });

export const ApiZodResponse = (status: number, schema: z.ZodType, description?: string) =>
  ApiResponse({ status, description, schema: openApiSchema(schema, 'output') });

/** Documents error statuses; every error has the body `{ code, message, details? }`. */
export const ApiErrors = (...statuses: number[]) =>
  applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, schema: openApiSchema(apiErrorSchema, 'output') }),
    ),
  );
