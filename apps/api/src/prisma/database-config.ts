import type { PoolConfig } from 'pg';

/** Audience of the Microsoft Entra tokens accepted by Azure Database for PostgreSQL. */
export const ENTRA_DATABASE_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

/** What `@azure/identity` credentials offer; replaced by a fake in tests. */
export interface TokenSource {
  getToken(scope: string): Promise<{ token: string } | null>;
}

async function managedIdentity(): Promise<TokenSource> {
  // Reads AZURE_CLIENT_ID, like the mail and storage clients; caches and renews the token.
  const { DefaultAzureCredential } = await import('@azure/identity');
  return new DefaultAzureCredential();
}

/**
 * Settings of the `pg` pool behind Prisma.
 *
 * password: DATABASE_URL as it is. entra: the fields of DATABASE_URL one by one and, as
 * password, a function `pg` calls for each new connection, which returns a token of the
 * managed identity. Not a connection string there: `pg` would replace the function with the
 * string's empty password.
 */
export function poolConfig(
  url: string,
  auth: 'password' | 'entra',
  tokenSource: () => Promise<TokenSource> = managedIdentity,
): PoolConfig {
  if (auth === 'password') {
    return { connectionString: url };
  }
  const parsed = new URL(url);
  let source: Promise<TokenSource> | undefined;
  return {
    host: parsed.hostname,
    port: parsed.port === '' ? 5432 : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    // Azure requires TLS; the certificate is checked against the system authorities.
    ssl: parsed.searchParams.get('sslmode') !== 'disable',
    password: async () => {
      source ??= tokenSource();
      const token = await (await source).getToken(ENTRA_DATABASE_SCOPE);
      if (!token) {
        throw new Error('No Microsoft Entra token for the database (DATABASE_AUTH=entra)');
      }
      return token.token;
    },
  };
}
