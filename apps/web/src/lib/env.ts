import 'server-only';
import { parseWebEnv } from './env-schema';

/**
 * Validated environment, for server code only. Importing this module throws when a
 * variable is missing, so `next dev` and `next build` fail early.
 */
export const env = parseWebEnv({
  API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
});
