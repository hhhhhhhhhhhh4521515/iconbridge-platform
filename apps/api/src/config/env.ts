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
  /**
   * smtp: Nodemailer (Mailpit locally). azure: Azure Communication Services Email with the
   * managed identity (production), no SMTP setting or password.
   */
  EMAIL_TRANSPORT: z.enum(['smtp', 'azure']).default('smtp'),
  /** azure: https://<communication service>.<geo>.communication.azure.com */
  AZURE_COMMUNICATION_ENDPOINT: z
    .union([z.literal(''), z.url({ protocol: /^https$/ })])
    .default(''),
  /** smtp only. */
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** smtp: "Name <address>". azure: the address only; the display name is set in Azure. */
  MAIL_FROM: z.string().min(1),
  /**
   * background: a request queues its emails and returns; they are sent right after.
   * inline: the request waits for the first attempt (automated tests).
   */
  MAIL_DELIVERY: z.enum(['background', 'inline']).default('background'),
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
  /** Lifetime of an access token, in seconds. 15 minutes; shorter only to test the silent refresh. */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(900),
  /**
   * Address of the web app as the API reaches it, to tell it that public content changed.
   * Empty: WEB_ORIGIN is used.
   */
  WEB_INTERNAL_URL: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).default(''),
  /** Shared with the web app (same variable there). Empty: the web app is not told; its cache ends after a minute. */
  REVALIDATE_SECRET: z.union([z.literal(''), z.string().min(24)]).default(''),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  /** smtp only. Empty for a server without authentication (Mailpit). */
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  /**
   * "false" switches the rate limits off, for a load test on a workstation only:
   * refused when NODE_ENV is production.
   */
  RATE_LIMITS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Reverse proxies in front of the API whose X-Forwarded-For is trusted (0 locally). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5),
  /** "true" runs the scheduled tasks inside the API (local). "false" in Azure, where a Container Apps Job runs them. */
  SCHEDULER_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true'),
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
  .refine((env) => env.EMAIL_TRANSPORT !== 'smtp' || env.SMTP_HOST !== '', {
    path: ['SMTP_HOST'],
    message: 'Required with EMAIL_TRANSPORT=smtp',
  })
  .refine((env) => env.EMAIL_TRANSPORT !== 'azure' || env.AZURE_COMMUNICATION_ENDPOINT !== '', {
    path: ['AZURE_COMMUNICATION_ENDPOINT'],
    message: 'Required with EMAIL_TRANSPORT=azure',
  })
  .refine((env) => env.EMAIL_TRANSPORT !== 'azure' || z.email().safeParse(env.MAIL_FROM).success, {
    path: ['MAIL_FROM'],
    message: 'With EMAIL_TRANSPORT=azure, an address of the linked domain without a name',
  })
  .refine(
    (env) => env.NODE_ENV !== 'production' || !TURNSTILE_TEST_SECRET.test(env.TURNSTILE_SECRET_KEY),
    {
      path: ['TURNSTILE_SECRET_KEY'],
      message: 'A Turnstile test secret cannot be used in production',
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.RATE_LIMITS_ENABLED, {
    path: ['RATE_LIMITS_ENABLED'],
    message: 'The rate limits cannot be switched off in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ACCESS_TOKEN_TTL_SECONDS >= 300, {
    path: ['ACCESS_TOKEN_TTL_SECONDS'],
    message: 'In production an access token lives at least 5 minutes',
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
