import './zod-setup.js';
import { z } from 'zod';

/** Machine-readable error codes returned by the API in `ApiError.code`. */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'EMAIL_NOT_VERIFIED',
  'NOT_FOUND',
  'CONFLICT',
  'EMAIL_TAKEN',
  'INVALID_TOKEN',
  'WEAK_PASSWORD',
  'CAPTCHA_FAILED',
  'LAST_SUPER_ADMIN',
  'CANNOT_DISABLE_SELF',
  'INVALID_JOB_TRANSITION',
  'JOB_NOT_PUBLISHABLE',
  'JOB_HAS_APPLICATIONS',
  'UNSUPPORTED_FILE',
  'FILE_TOO_LARGE',
  'DOCUMENT_IN_USE',
  'PROFILE_INCOMPLETE',
  'PASSPORT_EXPIRED',
  'JOB_NOT_OPEN',
  'MAX_ACTIVE_APPLICATIONS',
  'CANNOT_WITHDRAW',
  'INVALID_APPLICATION_TRANSITION',
  'NO_POSITION_LEFT',
  'CONSENT_REQUIRED',
  'IMAGE_REQUIRED',
  'RATE_LIMITED',
  'REAPPLY_COOLDOWN',
  'UNDO_NOT_ALLOWED',
  'INTERNAL_ERROR',
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** Body of every error response of the API. */
export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  /** English, for developers and logs. The web app translates from `code`. */
  message: z.string(),
  /** Extra data, e.g. the list of invalid fields for VALIDATION_ERROR. */
  details: z.unknown().optional(),
  /** Only with REAPPLY_COOLDOWN: first moment the candidate may apply to this job again (ISO 8601). */
  nextAllowedAt: z.iso.datetime().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** One entry of `details` for VALIDATION_ERROR. */
export const validationIssueSchema = z.object({ path: z.string(), message: z.string() });
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const healthStatusSchema = z.enum(['ok', 'error']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/**
 * Commit the running image was built from (APP_VERSION, set from the image's VCS_REF);
 * "dev" outside an image. The deployment checks it to know the new revision answers.
 */
const versionSchema = z.string().min(1);

/** Body of GET /health/live. */
export const livenessSchema = z.object({
  status: z.literal('ok'),
  version: versionSchema,
});
export type Liveness = z.infer<typeof livenessSchema>;

/** Body of GET /health/ready (HTTP 200 when every check is ok, 503 otherwise). */
export const readinessSchema = z.object({
  status: healthStatusSchema,
  version: versionSchema,
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
