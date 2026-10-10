import { z } from 'zod';

/** Base64 text that decodes to exactly 32 bytes (an AES-256 key). */
export const aes256KeySchema = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, '32 bytes, base64 encoded');

/**
 * Environment contract of the API. Every variable is required: the process
 * refuses to start when one is missing or malformed (see `validateEnv`).
 * Keep apps/api/.env.example in sync with this schema.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  MAIL_FROM: z.string().min(1),
  AZURE_STORAGE_CONNECTION_STRING: z.string().min(1),
  PASSPORT_ENCRYPTION_KEY: aes256KeySchema,
});

export type Env = z.infer<typeof envSchema>;

/**
 * Used by ConfigModule at startup. The error lists variable names only,
 * never their values, so a bad secret cannot leak into the logs.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => {
        const name = issue.path.join('.');
        return `  - ${name}: ${raw[name] === undefined ? 'missing' : issue.code}`;
      })
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\nSee apps/api/.env.example for the expected variables.`,
    );
  }
  return result.data;
}
