import type { PoolConfig } from 'pg';
import { azureCredential } from '../common/azure-credential.js';
import { lazy } from '../common/lazy.js';

/** Audience of the Microsoft Entra tokens accepted by Azure Database for PostgreSQL. */
export const ENTRA_DATABASE_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

/**
 * An idle connection is kept 5 minutes (pg closes it after 10 s by default): opening one
 * costs a TLS handshake and, with Entra, a token check by the server. A replica that scales
 * to zero closes them all anyway.
 */
export const IDLE_TIMEOUT_MS = 5 * 60_000;

/** What `@azure/identity` credentials offer; replaced by a fake in tests. */
export interface TokenSource {
  getToken(scope: string): Promise<{ token: string } | null>;
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
  tokenSource: () => Promise<TokenSource> = azureCredential,
): PoolConfig {
  if (auth === 'password') {
    return { connectionString: url, idleTimeoutMillis: IDLE_TIMEOUT_MS };
  }
  const parsed = new URL(url);
  // The credential caches and renews the token; a failure to create it is retried.
  const source = lazy(tokenSource);
  return {
    host: parsed.hostname,
    port: parsed.port === '' ? 5432 : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    // Azure requires TLS; the certificate is checked against the system authorities.
    ssl: parsed.searchParams.get('sslmode') !== 'disable',
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    password: async () => {
      const token = await (await source()).getToken(ENTRA_DATABASE_SCOPE);
      if (!token) {
        throw new Error('No Microsoft Entra token for the database (DATABASE_AUTH=entra)');
      }
      return token.token;
    },
  };
}
