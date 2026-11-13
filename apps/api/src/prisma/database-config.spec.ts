import { ENTRA_DATABASE_SCOPE, poolConfig, type TokenSource } from './database-config.js';

const URL_ENTRA =
  'postgresql://id-iconbridge-prod@psql.example.postgres.database.azure.com:5432/iconbridge?sslmode=require&schema=public';

describe('poolConfig', () => {
  it('keeps DATABASE_URL as it is with a password', () => {
    const url = 'postgresql://iconbridge:secret@localhost:5432/iconbridge?schema=public';
    expect(poolConfig(url, 'password')).toEqual({
      connectionString: url,
      idleTimeoutMillis: 300_000,
    });
  });

  it('signs in with a token of the managed identity, asked for each new connection (audit H1)', async () => {
    const getToken = vi.fn<TokenSource['getToken']>();
    getToken
      .mockResolvedValueOnce({ token: 'token-1' })
      .mockResolvedValueOnce({ token: 'token-2' });
    const source = vi.fn(() => Promise.resolve({ getToken }));
    const config = poolConfig(URL_ENTRA, 'entra', source);

    expect(config).toMatchObject({
      host: 'psql.example.postgres.database.azure.com',
      port: 5432,
      user: 'id-iconbridge-prod',
      database: 'iconbridge',
      ssl: true,
      idleTimeoutMillis: 300_000,
    });
    expect(config).not.toHaveProperty('connectionString');
    const password = config.password as () => Promise<string>;
    expect(await password()).toBe('token-1');
    expect(await password()).toBe('token-2');
    expect(getToken).toHaveBeenCalledWith(ENTRA_DATABASE_SCOPE);
    // One credential for the pool; it caches and renews the token itself.
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('refuses to connect without a token', async () => {
    const config = poolConfig(URL_ENTRA, 'entra', () =>
      Promise.resolve({ getToken: () => Promise.resolve(null) }),
    );
    await expect((config.password as () => Promise<string>)()).rejects.toThrow(
      'DATABASE_AUTH=entra',
    );
  });

  it('reads an encoded user name, the default port and sslmode=disable', () => {
    const config = poolConfig('postgresql://ci%40agent@db/app?sslmode=disable', 'entra', () =>
      Promise.resolve({ getToken: () => Promise.resolve({ token: 't' }) }),
    );
    expect(config).toMatchObject({ user: 'ci@agent', port: 5432, database: 'app', ssl: false });
  });
});
