import { apiErrorSchema, currentUserSchema } from '@iconbridge/shared';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../src/auth/auth.constants.js';
import { verifyPassword } from '../../src/common/crypto/password.js';
import {
  API,
  BAD_CAPTCHA,
  cookieAttributes,
  cookieHeader,
  cookiesFrom,
  createTestApp,
  createUser,
  login,
  PASSWORD,
  resetDatabase,
  tokenFrom,
  type TestApp,
} from './app.js';

const EMAIL = 'amira@example.test';
const registration = {
  email: 'Amira@Example.test',
  password: PASSWORD,
  firstName: 'Amira',
  lastName: 'Ben Salah',
  phone: '+21612345678',
  country: 'TN',
  gdprConsent: true,
  turnstileToken: 'ok',
  locale: 'fr',
};

describe('authentication (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.outbox.length = 0;
  });

  const register = (overrides: Record<string, unknown> = {}) =>
    test
      .http()
      .post(`${API}/auth/register`)
      .send({ ...registration, ...overrides });

  it('register -> verify -> login -> me -> refresh -> logout', async () => {
    // Register
    const registered = await register().expect(201);
    expect(registered.body).toEqual({
      message: 'Registration received. Check your inbox to confirm your email address.',
    });
    expect(cookiesFrom(registered)).toEqual({});

    const stored = await test.prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
      include: { candidateProfile: true },
    });
    expect(stored.role).toBe('CANDIDATE');
    expect(stored.emailVerifiedAt).toBeNull();
    expect(stored.locale).toBe('fr');
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(stored.passwordHash ?? '', PASSWORD)).toBe(true);
    expect(stored.candidateProfile).toMatchObject({
      firstName: 'Amira',
      lastName: 'Ben Salah',
      phone: '+21612345678',
      countryOfResidence: 'TN',
    });
    expect(stored.candidateProfile?.gdprConsentAt).toBeInstanceOf(Date);

    // Verification email, in the language chosen at registration
    expect(test.outbox).toHaveLength(1);
    const email = test.outbox[0];
    expect(email?.to).toBe(EMAIL);
    expect(email?.subject).toContain('Confirmez votre adresse e-mail');
    expect(email?.text).toContain('http://localhost:3000/fr/verify-email?token=');
    const token = tokenFrom(email);
    const tokenRow = await test.prisma.emailToken.findFirstOrThrow({
      where: { userId: stored.id },
    });
    expect(tokenRow.tokenHash).not.toBe(token);
    expect(tokenRow.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Login is possible before verification, and reports it
    const early = await test
      .http()
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    expect(early.body).toMatchObject({ emailVerified: false });

    // Verify: once only
    await test.http().post(`${API}/auth/verify-email`).send({ token }).expect(204);
    const again = await test.http().post(`${API}/auth/verify-email`).send({ token }).expect(400);
    expect(again.body).toMatchObject({ code: 'INVALID_TOKEN' });

    // Login
    const loggedIn = await test
      .http()
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    expect(currentUserSchema.parse(loggedIn.body)).toMatchObject({
      email: EMAIL,
      role: 'CANDIDATE',
      emailVerified: true,
      locale: 'fr',
      firstName: 'Amira',
    });
    expect(JSON.stringify(loggedIn.body)).not.toMatch(/password|token/i);
    const cookies = cookiesFrom(loggedIn);
    expect(cookies.access?.split('.')).toHaveLength(3);
    expect(cookies.refresh).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Cookie flags
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      expect(cookieAttributes(loggedIn, name)).toEqual(
        expect.arrayContaining(['httponly', 'secure', 'samesite=lax']),
      );
    }
    expect(cookieAttributes(loggedIn, ACCESS_COOKIE)).toContain('max-age=900');
    expect(cookieAttributes(loggedIn, REFRESH_COOKIE)).toContain(`max-age=${7 * 24 * 60 * 60}`);
    expect(cookieAttributes(loggedIn, REFRESH_COOKIE)).toContain('path=/api/v1/auth');

    // The refresh token is stored hashed
    const session = await test.prisma.refreshToken.findMany({
      where: { userId: stored.id, revokedAt: null },
    });
    expect(session.map((row) => row.tokenHash)).not.toContain(cookies.refresh);

    // Me
    const me = await test
      .http()
      .get(`${API}/auth/me`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(me.body).toMatchObject({ id: stored.id, email: EMAIL });
    await test.http().get(`${API}/auth/me`).expect(401);

    // Refresh rotates both tokens
    const refreshed = await test
      .http()
      .post(`${API}/auth/refresh`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    const rotated = cookiesFrom(refreshed);
    expect(rotated.refresh).toBeDefined();
    expect(rotated.refresh).not.toBe(cookies.refresh);
    await test.http().get(`${API}/auth/me`).set('Cookie', cookieHeader(rotated)).expect(200);

    // Logout revokes the session and clears the cookies
    const loggedOut = await test
      .http()
      .post(`${API}/auth/logout`)
      .set('Cookie', cookieHeader(rotated))
      .expect(204);
    expect(cookiesFrom(loggedOut)).toEqual({ access: '', refresh: '' });
    await test.http().post(`${API}/auth/refresh`).set('Cookie', cookieHeader(rotated)).expect(401);
  });

  describe('refresh token rotation', () => {
    it('revokes the whole session when a rotated token is presented again', async () => {
      const user = await createUser(test, 'CANDIDATE');
      const first = user.cookies;
      const second = cookiesFrom(
        await test
          .http()
          .post(`${API}/auth/refresh`)
          .set('Cookie', cookieHeader(first))
          .expect(200),
      );

      // The stolen (already used) token is replayed.
      const replay = await test
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookieHeader(first))
        .expect(401);
      expect(replay.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(cookiesFrom(replay)).toEqual({ access: '', refresh: '' });

      // The legitimate holder of the newest token is signed out too.
      await test.http().post(`${API}/auth/refresh`).set('Cookie', cookieHeader(second)).expect(401);
      const active = await test.prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(active).toBe(0);
    });

    it('does not touch the other sessions of the same user', async () => {
      const user = await createUser(test, 'CANDIDATE');
      const otherDevice = await login(test, user.email);
      await test
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookieHeader(user.cookies))
        .expect(200);
      await test
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookieHeader(user.cookies))
        .expect(401);
      await test
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookieHeader(otherDevice))
        .expect(200);
    });

    it('refuses an unknown, a missing and an expired refresh token', async () => {
      const user = await createUser(test, 'CANDIDATE');
      await test.http().post(`${API}/auth/refresh`).expect(401);
      await test
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookieHeader({ refresh: 'x'.repeat(43) }))
        .expect(401);
      await test.prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await test
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookieHeader(user.cookies))
        .expect(401);
    });

    it('does not accept the refresh token as an access token', async () => {
      const user = await createUser(test, 'CANDIDATE');
      await test
        .http()
        .get(`${API}/auth/me`)
        .set('Cookie', `${ACCESS_COOKIE}=${user.cookies.refresh ?? ''}`)
        .expect(401);
    });
  });

  describe('registration rules', () => {
    it('answers the same for an address that already has an account, without creating or changing anything', async () => {
      const first = await register().expect(201);
      const before = await test.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      test.outbox.length = 0;

      const second = await register({
        password: 'another-strong-passphrase-77',
        firstName: 'Mallory',
      }).expect(201);
      expect(second.body).toEqual(first.body);
      expect(await test.prisma.user.count()).toBe(1);
      const after = await test.prisma.user.findUniqueOrThrow({
        where: { email: EMAIL },
        include: { candidateProfile: true },
      });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.candidateProfile?.firstName).toBe('Amira');

      // The owner of the address is told instead.
      expect(test.outbox).toHaveLength(1);
      expect(test.outbox[0]?.subject).toContain('Vous avez déjà un compte');
      expect(test.outbox[0]?.text).not.toContain('token=');
    });

    it('always creates a CANDIDATE, whatever the body says', async () => {
      await register({
        role: 'SUPER_ADMIN',
        isActive: true,
        emailVerifiedAt: new Date().toISOString(),
      }).expect(201);
      const user = await test.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(user.role).toBe('CANDIDATE');
      expect(user.emailVerifiedAt).toBeNull();
    });

    it.each([
      ['gdprConsent is false', { gdprConsent: false }, 'gdprConsent'],
      ['the password is shorter than 10 characters', { password: 'Sh0rt!pw' }, 'password'],
      ['the phone has no country code', { phone: '0612345678' }, 'phone'],
      ['the email is malformed', { email: 'not-an-email' }, 'email'],
      ['the Turnstile token is missing', { turnstileToken: undefined }, 'turnstileToken'],
    ])('answers 400 VALIDATION_ERROR when %s', async (_case, overrides, field) => {
      const response = await register(overrides).expect(400);
      expect(apiErrorSchema.parse(response.body).code).toBe('VALIDATION_ERROR');
      expect(
        (response.body as { details: { path: string }[] }).details.map((issue) => issue.path),
      ).toContain(field);
      expect(await test.prisma.user.count()).toBe(0);
    });

    it('refuses a password that zxcvbn scores below 3', async () => {
      const response = await register({ password: 'password12345' }).expect(400);
      expect(response.body).toMatchObject({ code: 'WEAK_PASSWORD', details: { minimumScore: 3 } });
      expect(await test.prisma.user.count()).toBe(0);
    });

    it('refuses a failed CAPTCHA', async () => {
      const response = await register({ turnstileToken: BAD_CAPTCHA }).expect(400);
      expect(response.body).toMatchObject({ code: 'CAPTCHA_FAILED' });
      expect(await test.prisma.user.count()).toBe(0);
      expect(test.outbox).toHaveLength(0);
    });

    it('sends the emails in English and Arabic too', async () => {
      await register({ email: 'en@example.test', locale: 'en' }).expect(201);
      await register({ email: 'ar@example.test', locale: 'ar' }).expect(201);
      expect(test.outbox[0]?.subject).toContain('Confirm your email address');
      expect(test.outbox[1]?.subject).toContain('أكّد عنوان بريدك الإلكتروني');
      expect(test.outbox[1]?.html).toContain('dir="rtl"');
      expect(test.outbox[1]?.text).toContain('/ar/verify-email?token=');
    });
  });

  describe('email verification', () => {
    it('resend-verification sends a new link and the previous one stops working', async () => {
      await register().expect(201);
      const firstToken = tokenFrom(test.outbox[0]);
      const resent = await test
        .http()
        .post(`${API}/auth/resend-verification`)
        .send({ email: EMAIL })
        .expect(202);
      expect(resent.body).toEqual({
        message: 'If this address can receive it, an email has been sent.',
      });
      const secondToken = tokenFrom(test.outbox[1]);
      expect(secondToken).not.toBe(firstToken);
      await test.http().post(`${API}/auth/verify-email`).send({ token: firstToken }).expect(400);
      await test.http().post(`${API}/auth/verify-email`).send({ token: secondToken }).expect(204);
    });

    it('resend-verification answers the same and sends nothing for an unknown or already verified address', async () => {
      const user = await createUser(test, 'CANDIDATE');
      for (const email of ['nobody@example.test', user.email]) {
        const response = await test
          .http()
          .post(`${API}/auth/resend-verification`)
          .send({ email })
          .expect(202);
        expect(response.body).toEqual({
          message: 'If this address can receive it, an email has been sent.',
        });
      }
      expect(test.outbox).toHaveLength(0);
    });

    it('refuses an expired verification link', async () => {
      await register().expect(201);
      await test.prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await test
        .http()
        .post(`${API}/auth/verify-email`)
        .send({ token: tokenFrom(test.outbox[0]) })
        .expect(400);
    });

    it('does not accept a password-reset token to verify an email', async () => {
      await register().expect(201);
      await test.http().post(`${API}/auth/forgot-password`).send({ email: EMAIL }).expect(202);
      const resetToken = tokenFrom(test.outbox[1]);
      await test.http().post(`${API}/auth/verify-email`).send({ token: resetToken }).expect(400);
    });
  });

  describe('login protection', () => {
    const attempt = (email: string, password: string) =>
      test.http().post(`${API}/auth/login`).send({ email, password });

    it('answers the same 401 for an unknown email and for a wrong password', async () => {
      const user = await createUser(test, 'CANDIDATE');
      const unknown = await attempt('nobody@example.test', PASSWORD).expect(401);
      const wrong = await attempt(user.email, 'wrong-password-123').expect(401);
      expect(unknown.body).toEqual(wrong.body);
      expect(unknown.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(cookiesFrom(wrong)).toEqual({});
    });

    it('locks the account for 15 minutes after 5 wrong passwords, then lets the user in again', async () => {
      const user = await createUser(test, 'CANDIDATE');
      for (let i = 0; i < 5; i++) {
        await attempt(user.email, 'wrong-password-123').expect(401);
      }
      const locked = await test.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const minutes = ((locked.lockedUntil?.getTime() ?? 0) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);

      // The right password is refused while locked, with the same generic error.
      const refused = await attempt(user.email, PASSWORD).expect(401);
      expect(refused.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });

      // 15 minutes later.
      await test.prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await attempt(user.email, PASSWORD).expect(200);
      const unlocked = await test.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(unlocked).toMatchObject({ lockedUntil: null, failedLoginCount: 0 });
    });

    it('does not lock after 4 wrong passwords followed by the right one', async () => {
      const user = await createUser(test, 'CANDIDATE');
      for (let i = 0; i < 4; i++) {
        await attempt(user.email, 'wrong-password-123').expect(401);
      }
      await attempt(user.email, PASSWORD).expect(200);
      await attempt(user.email, 'wrong-password-123').expect(401);
      await attempt(user.email, PASSWORD).expect(200);
    });

    it('refuses a disabled account and an invited account without a password', async () => {
      const user = await createUser(test, 'CANDIDATE');
      await test.prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await attempt(user.email, PASSWORD).expect(401);
      await test.prisma.user.create({ data: { email: 'invited@example.test', role: 'VIEWER' } });
      await attempt('invited@example.test', '').expect(400);
      await attempt('invited@example.test', 'anything-at-all').expect(401);
    });

    it('accepts the email in any letter case', async () => {
      const user = await createUser(test, 'CANDIDATE', 'case@example.test');
      await attempt('  CASE@Example.TEST ', PASSWORD).expect(200);
      expect(user.email).toBe('case@example.test');
    });
  });

  describe('password reset', () => {
    it('forgot -> reset: one-time link, new password works, every session and token is dead', async () => {
      const user = await createUser(test, 'CANDIDATE');
      const otherDevice = await login(test, user.email);

      await test.http().post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(202);
      expect(test.outbox).toHaveLength(1);
      expect(test.outbox[0]?.subject).toContain('Reset your password');
      const token = tokenFrom(test.outbox[0]);
      const row = await test.prisma.emailToken.findFirstOrThrow({ where: { userId: user.id } });
      const minutes = (row.expiresAt.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(59);
      expect(minutes).toBeLessThanOrEqual(60);

      // A weak password is refused and does not burn the link.
      const weak = await test
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token, password: 'password12345' })
        .expect(400);
      expect(weak.body).toMatchObject({ code: 'WEAK_PASSWORD' });

      const newPassword = 'another-strong-passphrase-77';
      await test
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token, password: newPassword })
        .expect(204);

      // One time only.
      const reused = await test
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token, password: 'yet-another-passphrase-55' })
        .expect(400);
      expect(reused.body).toMatchObject({ code: 'INVALID_TOKEN' });

      // Old sessions: refresh tokens revoked, access tokens rejected at once.
      await test.http().get(`${API}/auth/me`).set('Cookie', cookieHeader(user.cookies)).expect(401);
      await test
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookieHeader(otherDevice))
        .expect(401);

      await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(401);
      await login(test, user.email, newPassword);
    });

    it('answers the same and sends nothing for an unknown address', async () => {
      const response = await test
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ email: 'nobody@example.test' })
        .expect(202);
      expect(response.body).toEqual({
        message: 'If this address can receive it, an email has been sent.',
      });
      expect(test.outbox).toHaveLength(0);
    });

    it('refuses an expired reset link', async () => {
      const user = await createUser(test, 'CANDIDATE');
      await test.http().post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(202);
      await test.prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await test
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token: tokenFrom(test.outbox[0]), password: 'another-strong-passphrase-77' })
        .expect(400);
    });

    it('a reset also unlocks a locked account', async () => {
      const user = await createUser(test, 'CANDIDATE');
      await test.prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + 600_000) },
      });
      await test.http().post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(202);
      await test
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ token: tokenFrom(test.outbox[0]), password: 'another-strong-passphrase-77' })
        .expect(204);
      await login(test, user.email, 'another-strong-passphrase-77');
    });
  });

  describe('global HTTP behaviour', () => {
    it('returns errors as { code, message, details } without a stack', async () => {
      const notFound = await test
        .http()
        .get(`${API}/does-not-exist`)
        .set('Cookie', 'x=y')
        .expect(404);
      expect(apiErrorSchema.parse(notFound.body).code).toBe('NOT_FOUND');
      const malformed = await test
        .http()
        .post(`${API}/auth/login`)
        .set('Content-Type', 'application/json')
        .send('{"email":')
        .expect(400);
      expect(apiErrorSchema.parse(malformed.body).code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(malformed.body)).not.toMatch(/stack|node_modules|\.ts:/);
    });

    it('sets security headers and a request id, and echoes a caller-supplied id', async () => {
      const response = await test.http().get(`${API}/auth/me`).expect(401);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const echoed = await test.http().get(`${API}/auth/me`).set('x-request-id', 'trace-1234-abcd');
      expect(echoed.headers['x-request-id']).toBe('trace-1234-abcd');
    });

    it('allows cross-origin calls with cookies from the web app only', async () => {
      const allowed = await test
        .http()
        .options(`${API}/auth/login`)
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      const other = await test
        .http()
        .options(`${API}/auth/login`)
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
      expect(other.headers['access-control-allow-origin']).not.toBe('*');
    });

    it('documents the auth and admin routes in OpenAPI with cookie authentication', async () => {
      const response = await test.http().get('/api/docs-json').expect(200);
      const document = response.body as {
        paths: Record<string, Record<string, { requestBody?: unknown; security?: unknown }>>;
        components: { securitySchemes: Record<string, { type: string; in: string; name: string }> };
      };
      for (const path of [
        'register',
        'verify-email',
        'resend-verification',
        'login',
        'refresh',
        'logout',
        'forgot-password',
        'reset-password',
      ]) {
        expect(document.paths[`${API}/auth/${path}`]).toHaveProperty('post');
      }
      expect(document.paths[`${API}/auth/me`]).toHaveProperty('get');
      expect(document.paths[`${API}/auth/register`]?.['post']?.requestBody).toBeDefined();
      expect(document.paths[`${API}/admin/users`]).toHaveProperty('post');
      expect(document.components.securitySchemes['cookie']).toMatchObject({
        type: 'apiKey',
        in: 'cookie',
        name: ACCESS_COOKIE,
      });
    });
  });
});
