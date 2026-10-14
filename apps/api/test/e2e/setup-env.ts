import { testDatabaseUrl } from './test-database.js';

// Environment of the e2e suites: a real PostgreSQL test database; mail and CAPTCHA are faked in app.ts.
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '4001',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: testDatabaseUrl(),
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  MAIL_FROM: 'IconBridge Jobs <no-reply@example.test>',
  // The request waits for the email, so a test reads the outbox right after it.
  MAIL_DELIVERY: 'inline',
  AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
  AZURE_STORAGE_ACCOUNT_URL: '',
  PUBLIC_MEDIA_BASE_URL: 'http://localhost:10000/devstoreaccount1/public-media',
  // Fixed, public test values: never used outside the test runner.
  PASSPORT_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  JWT_ACCESS_SECRET: 'e2e-only-jwt-secret-0123456789abcdef',
  TURNSTILE_SECRET_KEY: 'e2e-secret',
  TRUST_PROXY_HOPS: '0',
  SCHEDULER_ENABLED: 'false',
});
