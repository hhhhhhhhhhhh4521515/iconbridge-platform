import { hashPassword } from '../../src/common/crypto/password.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { SeedEnv } from './env.js';

/**
 * Creates the first super admin. If a user already has this email nothing is
 * changed: a new seed must not reset a password or re-enable a disabled account.
 */
export async function seedSuperAdmin(
  prisma: PrismaClient,
  env: SeedEnv,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { email: env.SEED_ADMIN_EMAIL },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }
  const admin = await prisma.user.create({
    data: {
      email: env.SEED_ADMIN_EMAIL,
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: 'SUPER_ADMIN',
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  return { id: admin.id, created: true };
}
