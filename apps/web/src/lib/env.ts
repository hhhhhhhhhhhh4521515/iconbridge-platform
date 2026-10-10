import { parseWebEnv } from './env-schema';

/**
 * Validated environment of the web app. Importing this module throws when a
 * variable is missing, so `next dev` and `next build` fail early.
 */
// Each variable is read by its full name so Next.js can inline it at build time.
export const env = parseWebEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
