import { z } from 'zod';

/** Machine-readable error codes returned by the API in `ApiError.code`. */
export const API_ERROR_CODES = ['VALIDATION_ERROR', 'REAPPLY_COOLDOWN'] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const healthStatusSchema = z.enum(['ok', 'error']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/** Body of GET /health/live. */
export const livenessSchema = z.object({
  status: z.literal('ok'),
});
export type Liveness = z.infer<typeof livenessSchema>;

/** Body of GET /health/ready (HTTP 200 when every check is ok, 503 otherwise). */
export const readinessSchema = z.object({
  status: healthStatusSchema,
  checks: z.object({
    database: healthStatusSchema,
  }),
});
export type Readiness = z.infer<typeof readinessSchema>;

/** Query string accepted by every paginated list endpoint. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
