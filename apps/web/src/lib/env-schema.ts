import { z } from 'zod';

const httpUrl = z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, ''));

/**
 * Environment contract of the web app. Keep apps/web/.env.example in sync.
 * NEXT_PUBLIC_* values are inlined into the browser bundle: never put a secret there.
 */
export const webEnvSchema = z.object({
  /** Address of the API as the web server reaches it. Never sent to the browser. */
  API_INTERNAL_URL: httpUrl,
  /** Public address of the site, for canonical links, hreflang, the sitemap and Open Graph. */
  NEXT_PUBLIC_SITE_URL: httpUrl,
  /** Cloudflare Turnstile site key (public by nature). */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseWebEnv(raw: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse(raw);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid web environment (${names}). See apps/web/.env.example.`);
  }
  return result.data;
}

/** Cloudflare's public test keys: the widget is skipped and a fixed token is sent. */
export const TURNSTILE_TEST_SITE_KEY = /^[123]x0{10,}/;
