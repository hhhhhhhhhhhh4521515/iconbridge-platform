// Environment for the test runner. No real service is contacted: the database is mocked.
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '4001',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'IconBridge Jobs <no-reply@example.test>',
  AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
  // Fixed, public test key: never used outside the test runner.
  PASSPORT_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  JWT_ACCESS_SECRET: 'test-only-jwt-secret-0123456789abcdef',
  TURNSTILE_SECRET_KEY: 'test-secret',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  TRUST_PROXY_HOPS: '0',
});
