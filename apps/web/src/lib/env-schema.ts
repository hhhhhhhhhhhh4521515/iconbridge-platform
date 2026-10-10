import { z } from 'zod';

/**
 * Environment contract of the web app. Keep apps/web/.env.example in sync.
 * NEXT_PUBLIC_* values are inlined into the browser bundle: never put a secret there.
 */
export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
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
