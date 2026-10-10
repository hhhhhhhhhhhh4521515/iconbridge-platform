import { RATE_LIMITS } from '../../src/auth/auth.constants.js';
import { API, createTestApp, resetDatabase, type TestApp } from './app.js';

describe('rate limiting (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp({ throttling: true });
    await resetDatabase(test.prisma);
  });
  afterAll(async () => {
    await test.close();
  });

  it('limits login to 5 attempts per minute and per IP, then answers 429', async () => {
    const attempt = () =>
      test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@example.test', password: 'wrong-password-123' });
    for (let i = 0; i < RATE_LIMITS.authSensitive.limit; i++) {
      expect((await attempt()).status).toBe(401);
    }
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again later.',
    });
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('is stricter on /auth than on the rest of the API', () => {
    expect(RATE_LIMITS.authSensitive.limit).toBeLessThan(RATE_LIMITS.auth.limit);
    expect(RATE_LIMITS.auth.limit).toBeLessThan(RATE_LIMITS.default.limit);
  });

  it('allows more calls on the less sensitive auth routes, up to their own limit', async () => {
    const call = () => test.http().post(`${API}/auth/logout`);
    for (let i = 0; i < RATE_LIMITS.auth.limit; i++) {
      expect((await call()).status).toBe(204);
    }
    expect((await call()).status).toBe(429);
  });

  it('never limits the health probes', async () => {
    for (let i = 0; i < RATE_LIMITS.default.limit + 5; i++) {
      await test.http().get('/health/live').expect(200);
    }
  });
});
