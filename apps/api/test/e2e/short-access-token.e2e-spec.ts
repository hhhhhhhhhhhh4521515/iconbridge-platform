// The lifetime is read when the application module is loaded: it is set before any import.
// 3 s, not 1: token times are whole seconds, so a 1-second token issued late in a second
// lived only a few milliseconds and the first call failed when the suite was busy.
vi.hoisted(() => {
  process.env.ACCESS_TOKEN_TTL_SECONDS = '3';
});

import {
  API,
  cookieHeader,
  cookiesFrom,
  createTestApp,
  createUser,
  resetDatabase,
  type TestApp,
  type TestUser,
} from './app.js';

describe('short access tokens (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
    await resetDatabase(test.prisma);
  });
  afterAll(async () => {
    delete process.env.ACCESS_TOKEN_TTL_SECONDS;
    await test.close();
  });

  it('expire, and the refresh token gives a new one without signing in again', async () => {
    const user = await createUser(test, 'CANDIDATE');
    const call = (cookies: TestUser['cookies']) =>
      test.http().get(`${API}/me/profile`).set('Cookie', cookieHeader(cookies));
    await call(user.cookies).expect(200);

    await new Promise((resolve) => setTimeout(resolve, 4100));
    const expired = await call(user.cookies).expect(401);
    expect((expired.body as { code: string }).code).toBe('UNAUTHENTICATED');
    // The page that shows "who is signed in" answers 200 with nobody: the browser then renews.
    const session = await test
      .http()
      .get(`${API}/auth/session`)
      .set('Cookie', cookieHeader(user.cookies))
      .expect(200);
    expect(session.body).toEqual({ user: null });

    const refreshed = await test
      .http()
      .post(`${API}/auth/refresh`)
      .set('Cookie', cookieHeader(user.cookies))
      .expect(200);
    const fresh = cookiesFrom(refreshed);
    expect(fresh.access).not.toBe(user.cookies.access);
    await call(fresh).expect(200);
    // The old refresh token was replaced: it cannot be used a second time.
    await test
      .http()
      .post(`${API}/auth/refresh`)
      .set('Cookie', cookieHeader(user.cookies))
      .expect(401);
  });
});
