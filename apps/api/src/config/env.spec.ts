import { envSchema, validateEnv } from './env.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://user:s3cret-value@localhost:5432/db',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'IconBridge Jobs <no-reply@example.test>',
  AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
};

describe('validateEnv', () => {
  it('returns typed values and coerces the ports', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.SMTP_PORT).toBe(1025);
  });

  it.each(Object.keys(envSchema.shape))('refuses to start when %s is missing', (name) => {
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

  it('never prints a value in the error message', () => {
    const attempt = () => validateEnv({ ...valid, PORT: 'abc', SMTP_HOST: undefined });
    expect(attempt).toThrow(/Invalid environment configuration/);
    expect(attempt).not.toThrow(/s3cret-value/);
  });
});
