import { describe, expect, it } from 'vitest';
import { paginationQuerySchema, readinessSchema } from './schemas.js';

describe('paginationQuerySchema', () => {
  it('applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces query-string values', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('rejects a page size above 100 and a page below 1', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('readinessSchema', () => {
  it('accepts a healthy response', () => {
    const body = { status: 'ok', checks: { database: 'ok' } };
    expect(readinessSchema.parse(body)).toEqual(body);
  });

  it('rejects a response without the database check', () => {
    expect(readinessSchema.safeParse({ status: 'ok', checks: {} }).success).toBe(false);
  });
});
