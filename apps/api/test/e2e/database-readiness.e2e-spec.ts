import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { testDatabaseUrl } from './test-database.js';

// The credential of the apps, replaced: the token it returns is the local password, so the
// Entra path (a token per new connection) runs against the real test database.
const getToken = vi.hoisted(() => vi.fn<(scope: string) => Promise<{ token: string } | null>>());
vi.mock('../../src/common/azure-credential.js', () => ({
  azureCredential: () => Promise.resolve({ getToken }),
}));

/** A PrismaService as in Azure: DATABASE_AUTH=entra, no password in DATABASE_URL. */
function entraService(): { prisma: PrismaService; password: string } {
  const url = new URL(testDatabaseUrl());
  const password = decodeURIComponent(url.password);
  url.password = '';
  url.searchParams.set('sslmode', 'disable');
  const values: Partial<Env> = { DATABASE_URL: url.toString(), DATABASE_AUTH: 'entra' };
  const config = { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
  return { prisma: new PrismaService(config), password };
}

describe('database readiness (e2e, real database)', () => {
  let prisma: PrismaService | undefined;

  beforeEach(() => {
    getToken.mockReset();
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    prisma = undefined;
  });

  it('is ready once it has a token and a transaction runs', async () => {
    const service = entraService();
    prisma = service.prisma;
    getToken.mockResolvedValue({ token: service.password });

    await expect(prisma.checkDatabase()).resolves.toBeUndefined();
    // Once for the readiness check itself, once for the pool's first connection.
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledWith('https://ossrdbms-aad.database.windows.net/.default');
  });

  it('is not ready while the managed identity gives no token', async () => {
    const service = entraService();
    prisma = service.prisma;
    getToken.mockRejectedValue(new Error('ManagedIdentityCredential: no response'));

    await expect(prisma.checkDatabase()).rejects.toThrow('no response');
  });

  it('is not ready when the token is refused by the database', async () => {
    const service = entraService();
    prisma = service.prisma;
    getToken.mockResolvedValue({ token: 'not-the-password' });

    await expect(prisma.checkDatabase()).rejects.toThrow();
  });
});
