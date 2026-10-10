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
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  MAIL_FROM: z.string().min(1),
  /** Azurite or an account key. Leave empty in Azure and set AZURE_STORAGE_ACCOUNT_URL instead. */
  AZURE_STORAGE_CONNECTION_STRING: z.string(),
  /** https://<account>.blob.core.windows.net, used with the managed identity. Empty locally. */
  AZURE_STORAGE_ACCOUNT_URL: z.union([z.literal(''), z.url({ protocol: /^https$/ })]),
  /** Public URL of the `public-media` blob container, without a trailing slash. */
  PUBLIC_MEDIA_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .transform((url) => url.replace(/\/+$/, '')),
  PASSPORT_ENCRYPTION_KEY: aes256KeySchema,
  JWT_ACCESS_SECRET: z.string().min(32),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  /** Empty for a server without authentication (Mailpit). */
  SMTP_USER: z.string(),
  SMTP_PASSWORD: z.string(),
  /** Reverse proxies in front of the API whose X-Forwarded-For is trusted (0 locally). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5),
});

/** Cloudflare's public Turnstile test secrets; they accept (or refuse) every token. */
const TURNSTILE_TEST_SECRET = /^[123]x0{10,}/;

export const envSchema = baseEnvSchema
  .refine(
    (env) =>
      (env.AZURE_STORAGE_CONNECTION_STRING === '') !== (env.AZURE_STORAGE_ACCOUNT_URL === ''),
    {
      path: ['AZURE_STORAGE_CONNECTION_STRING'],
      message: 'Set exactly one of AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_ACCOUNT_URL',
    },
  )
  .refine(
    (env) => env.NODE_ENV !== 'production' || !TURNSTILE_TEST_SECRET.test(env.TURNSTILE_SECRET_KEY),
    {
      path: ['TURNSTILE_SECRET_KEY'],
      message: 'A Turnstile test secret cannot be used in production',
    },
  );

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
