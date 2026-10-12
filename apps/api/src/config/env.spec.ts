import { validateEnv } from './env.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://user:s3cret-value@localhost:5432/db',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'IconBridge Jobs <no-reply@example.test>',
  AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
  AZURE_STORAGE_ACCOUNT_URL: '',
  PUBLIC_MEDIA_BASE_URL: 'http://localhost:10000/devstoreaccount1/public-media',
  PASSPORT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  TURNSTILE_SECRET_KEY: 'test-secret',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  TRUST_PROXY_HOPS: '0',
  SCHEDULER_ENABLED: 'true',
};

describe('validateEnv', () => {
  it('returns typed values and coerces the ports', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.SMTP_PORT).toBe(1025);
  });

  it.each(Object.keys(valid))('refuses to start when %s is missing', (name) => {
    const { [name]: _removed, ...rest } = valid as Record<string, string>;
    expect(() => validateEnv(rest)).toThrow(new RegExp(`- ${name}: missing`));
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
  });

  it('accepts empty SMTP credentials (Mailpit) and rejects a short JWT secret', () => {
    expect(validateEnv(valid).SMTP_USER).toBe('');
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('refuses a Cloudflare test secret in production, and accepts it elsewhere', () => {
    const testSecret = '1x0000000000000000000000000000000AA';
    expect(() =>
      validateEnv({ ...valid, NODE_ENV: 'production', TURNSTILE_SECRET_KEY: testSecret }),
    ).toThrow(/TURNSTILE_SECRET_KEY/);
    expect(validateEnv({ ...valid, TURNSTILE_SECRET_KEY: testSecret }).TURNSTILE_SECRET_KEY).toBe(
      testSecret,
    );
    expect(validateEnv({ ...valid, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });

  it('refuses test conveniences in production: no rate limits, very short tokens', () => {
    const production = { ...valid, NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'real-secret' };
    expect(() => validateEnv(production)).not.toThrow();
    expect(() => validateEnv({ ...production, RATE_LIMITS_ENABLED: 'false' })).toThrow(
      /RATE_LIMITS_ENABLED/,
    );
    expect(() => validateEnv({ ...production, ACCESS_TOKEN_TTL_SECONDS: '5' })).toThrow(
      /ACCESS_TOKEN_TTL_SECONDS/,
    );
    const local = validateEnv({
      ...valid,
      RATE_LIMITS_ENABLED: 'false',
      ACCESS_TOKEN_TTL_SECONDS: '5',
    });
    expect(local).toMatchObject({ RATE_LIMITS_ENABLED: false, ACCESS_TOKEN_TTL_SECONDS: 5 });
    // Defaults: limits on, 15 minutes, emails sent in the background.
    expect(validateEnv(valid)).toMatchObject({
      RATE_LIMITS_ENABLED: true,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      MAIL_DELIVERY: 'background',
      REVALIDATE_SECRET: '',
    });
    expect(() => validateEnv({ ...valid, REVALIDATE_SECRET: 'too-short' })).toThrow(
      /REVALIDATE_SECRET/,
    );
  });

  it('needs exactly one way to reach blob storage', () => {
    const accountUrl = 'https://example.blob.core.windows.net';
    expect(() => validateEnv({ ...valid, AZURE_STORAGE_CONNECTION_STRING: '' })).toThrow(
      /AZURE_STORAGE_CONNECTION_STRING/,
    );
    expect(() => validateEnv({ ...valid, AZURE_STORAGE_ACCOUNT_URL: accountUrl })).toThrow(
      /AZURE_STORAGE_CONNECTION_STRING/,
    );
    expect(
      validateEnv({
        ...valid,
        AZURE_STORAGE_CONNECTION_STRING: '',
        AZURE_STORAGE_ACCOUNT_URL: accountUrl,
      }).AZURE_STORAGE_ACCOUNT_URL,
    ).toBe(accountUrl);
    expect(() =>
      validateEnv({
        ...valid,
        AZURE_STORAGE_CONNECTION_STRING: '',
        AZURE_STORAGE_ACCOUNT_URL: 'http://example.blob.core.windows.net',
      }),
    ).toThrow(/AZURE_STORAGE_ACCOUNT_URL/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    const short = Buffer.alloc(16, 7).toString('base64');
    expect(() => validateEnv({ ...valid, PASSPORT_ENCRYPTION_KEY: short })).toThrow(
      /PASSPORT_ENCRYPTION_KEY/,
    );
  });

  it('never prints a value in the error message', () => {
    const attempt = () => validateEnv({ ...valid, PORT: 'abc', SMTP_HOST: undefined });
    expect(attempt).toThrow(/Invalid environment configuration/);
    expect(attempt).not.toThrow(/s3cret-value/);
  });
});
