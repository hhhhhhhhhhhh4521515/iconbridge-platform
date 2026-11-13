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

  it('runs transactions while a new connection takes longer than 2 s to open', async () => {
    // Prisma runs transactions, and queries it groups into a batch, with a wait for a
    // connection: 2 s by default. On a new revision a connection takes longer (TLS, a token,
    // a busy 0.5 vCPU): on 12 and 13 November its first requests answered 500 with "Unable to
    // start a transaction in the given time". Reproduced here with a token that takes 2.5 s.
    const service = entraService();
    const client = service.prisma;
    prisma = client;
    getToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ token: service.password });
          }, 2500);
        }),
    );
    await expect(
      client.$transaction(async (tx) => tx.$queryRaw<{ one: number }[]>`SELECT 1 AS one`),
    ).resolves.toEqual([{ one: 1 }]);
    const [first, second] = await client.$transaction([client.job.count(), client.job.count()]);
    expect(first).toBe(second);
  }, 30_000);

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
