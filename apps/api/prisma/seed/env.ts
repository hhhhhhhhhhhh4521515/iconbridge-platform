import { z } from 'zod';
import { aes256KeySchema } from '../../src/config/env.js';

/** Variables the seed needs. Same rule as the API: it stops if one is missing. */
const seedEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PASSPORT_ENCRYPTION_KEY: aes256KeySchema,
  SEED_ADMIN_EMAIL: z.email().transform((email) => email.toLowerCase()),
  SEED_ADMIN_PASSWORD: z.string().min(12),
});

export type SeedEnv = z.infer<typeof seedEnvSchema>;

export function loadSeedEnv(raw: Record<string, string | undefined>): SeedEnv {
  const result = seedEnvSchema.safeParse(raw);
  if (!result.success) {
    // Names only: the values include a password and a key.
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Cannot seed: missing or invalid ${names.join(', ')}. See apps/api/.env.example.`,
    );
  }
  return result.data;
}
