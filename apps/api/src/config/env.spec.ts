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

  /** Optional since the Azure transport: SMTP needs a host only (port 587, no credentials by default). */
  const smtpDefaults = ['SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'];

  it.each(Object.keys(valid).filter((name) => !smtpDefaults.includes(name)))(
    'refuses to start when %s is missing',
    (name) => {
      const { [name]: _removed, ...rest } = valid as Record<string, string>;
      expect(() => validateEnv(rest)).toThrow(new RegExp(`- ${name}: missing`));
    },
  );

  describe('email transport', () => {
    const azure = {
      ...valid,
      EMAIL_TRANSPORT: 'azure',
      AZURE_COMMUNICATION_ENDPOINT: 'https://acs-iconbridge.europe.communication.azure.com',
      MAIL_FROM: 'DoNotReply@0000-1111.azurecomm.net',
    };
    const {
      SMTP_HOST: _host,
      SMTP_PORT: _port,
      SMTP_USER: _user,
      SMTP_PASSWORD: _pass,
      ...noSmtp
    } = azure;

    it('uses SMTP by default, on port 587 without credentials', () => {
      const { SMTP_PORT: _p, SMTP_USER: _u, SMTP_PASSWORD: _w, ...rest } = valid;
      const env = validateEnv(rest);
      expect(env.EMAIL_TRANSPORT).toBe('smtp');
      expect(env.SMTP_PORT).toBe(587);
      expect(env.SMTP_USER).toBe('');
    });

    it('needs no SMTP setting with Azure Communication Services', () => {
      const env = validateEnv(noSmtp);
      expect(env.EMAIL_TRANSPORT).toBe('azure');
      expect(env.SMTP_PASSWORD).toBe('');
    });

    it('needs the endpoint of the Communication Service with Azure', () => {
      expect(() => validateEnv({ ...noSmtp, AZURE_COMMUNICATION_ENDPOINT: '' })).toThrow(
        /AZURE_COMMUNICATION_ENDPOINT/,
      );
      expect(() =>
        validateEnv({ ...noSmtp, AZURE_COMMUNICATION_ENDPOINT: 'http://acs.example.test' }),
      ).toThrow(/AZURE_COMMUNICATION_ENDPOINT/);
    });

    it('needs a bare sender address with Azure (the display name is set in Azure)', () => {
      expect(() =>
        validateEnv({ ...noSmtp, MAIL_FROM: 'IconBridge <DoNotReply@0000-1111.azurecomm.net>' }),
      ).toThrow(/MAIL_FROM/);
    });

    it('needs a host with SMTP', () => {
      expect(() => validateEnv({ ...valid, SMTP_HOST: '' })).toThrow(/SMTP_HOST/);
    });

    it('has no hourly quota by default, and refuses a negative one', () => {
      expect(validateEnv(valid).EMAIL_HOURLY_QUOTA).toBe(0);
      expect(validateEnv({ ...noSmtp, EMAIL_HOURLY_QUOTA: '10' }).EMAIL_HOURLY_QUOTA).toBe(10);
      expect(() => validateEnv({ ...valid, EMAIL_HOURLY_QUOTA: '-1' })).toThrow(
        /EMAIL_HOURLY_QUOTA/,
      );
    });

    it('refuses an unknown transport', () => {
      expect(() => validateEnv({ ...valid, EMAIL_TRANSPORT: 'sendgrid' })).toThrow(
        /EMAIL_TRANSPORT/,
      );
    });
  });

  it('reads the other addresses of the site as a list, empty by default', () => {
    expect(validateEnv(valid).WEB_ORIGIN_ALIASES).toEqual([]);
    expect(
      validateEnv({
        ...valid,
        WEB_ORIGIN_ALIASES: ' https://old.example.test , https://www.example.test,',
      }).WEB_ORIGIN_ALIASES,
    ).toEqual(['https://old.example.test', 'https://www.example.test']);
    expect(() => validateEnv({ ...valid, WEB_ORIGIN_ALIASES: 'old.example.test' })).toThrow(
      /WEB_ORIGIN_ALIASES/,
    );
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
