import './zod-setup.js';
import { z } from 'zod';
import { ADMIN_ROLES, userRoleSchema } from './enums.js';
import { countryCodeSchema } from './countries.js';
import { localeSchema } from './i18n.js';
import { paginationQuerySchema } from './schemas.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
/** Minimum zxcvbn score (0 to 4). Checked by the API, which answers WEAK_PASSWORD below it. */
export const PASSWORD_MIN_SCORE = 3;

/** Trimmed and lower-cased: emails are stored and compared in lower case. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Length only. Strength (zxcvbn) is checked by the API because the dictionaries are large. */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** E.164: "+" then country code and number, 7 to 15 digits. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use the international format, e.g. +21612345678');

const nameSchema = z.string().trim().min(1).max(100);
/** Opaque token from an email link. */
const emailTokenSchema = z.string().min(20).max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema,
  /** Country of residence. */
  country: countryCodeSchema,
  /** Must be true: consent to the processing of personal data. */
  gdprConsent: z.literal(true),
  /** Cloudflare Turnstile response token. */
  turnstileToken: z.string().min(1).max(2048),
  /** Language of the emails; defaults to English. */
  locale: localeSchema.default('en'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: emailTokenSchema });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const emailOnlySchema = z.object({ email: emailSchema });
export type EmailOnlyInput = z.infer<typeof emailOnlySchema>;

/** Used with a reset-password token and with an invitation (set-password) token. */
export const resetPasswordSchema = z.object({
  token: emailTokenSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Body of GET /auth/me and of a successful login. */
export const currentUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: userRoleSchema,
  emailVerified: z.boolean(),
  locale: localeSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** Generic acknowledgement used where the API must not reveal whether an account exists. */
export const acknowledgementSchema = z.object({ message: z.string() });
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;

// --- Admin accounts (super admin only) ---

export const adminRoleSchema = z.enum(ADMIN_ROLES);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const createAdminUserSchema = z.object({
  email: emailSchema,
  role: adminRoleSchema,
  /** Language of the invitation email. */
  locale: localeSchema.default('en'),
});
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const changeAdminRoleSchema = z.object({ role: adminRoleSchema });
export type ChangeAdminRoleInput = z.infer<typeof changeAdminRoleSchema>;

export const listAdminUsersQuerySchema = paginationQuerySchema.extend({
  role: adminRoleSchema.optional(),
});
export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;

export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: adminRoleSchema,
  isActive: z.boolean(),
  /** False while the invitation has not been accepted. */
  hasPassword: z.boolean(),
  locale: localeSchema,
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const uuidParamSchema = z.object({ id: z.uuid() });

/** Shape of every paginated list. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
