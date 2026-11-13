import { currentUserSchema } from '@iconbridge/shared';
import {
  API,
  BAD_CAPTCHA,
  cookieHeader,
  createPartnerLogin,
  createTestApp,
  createUser,
  PASSWORD,
  resetDatabase,
  tokenFrom,
  type TestApp,
} from './app.js';

const NEW_PASSWORD = 'amber-falcon-meadow-77';

/** The partner sign-in, forgot and reset password (ADR-027, section 7 and answer 6). */
describe('partner sign-in and password reset (e2e, ADR-027)', () => {
  let test: TestApp;
  let spaceId: string;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.outbox.length = 0;
    spaceId = (
      await test.prisma.partnerSpace.create({
        data: { name: 'E2E Sign-in Co', country: 'PL', defaultLocale: 'pl' },
      })
    ).id;
  });

  const signIn = (body: object) => test.http().post(`${API}/auth/partner-login`).send(body);

  it('signs a partner login in with Turnstile, with the usual cookies', async () => {
    const partner = await createPartnerLogin(test, spaceId, 'e2e-partner@example.test');
    const response = await signIn({
      email: partner.email,
      password: PASSWORD,
      turnstileToken: 'ok',
    }).expect(200);
    expect(currentUserSchema.parse(response.body)).toMatchObject({
      id: partner.id,
      role: 'PARTNER',
    });
    const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    expect(
      cookies.some((cookie) => cookie.startsWith('ib_access=') && /HttpOnly/i.test(cookie)),
    ).toBe(true);
    expect(
      cookies.some(
        (cookie) => cookie.startsWith('ib_refresh=') && /Path=\/api\/v1\/auth/.test(cookie),
      ),
    ).toBe(true);
    // The session opens the partner area.
    const access = cookies.find((cookie) => cookie.startsWith('ib_access=')) ?? '';
    await test
      .http()
      .get(`${API}/partner-spaces/${spaceId}`)
      .set('Cookie', access.split(';')[0] ?? '')
      .expect(200);
  });

  it('refuses without Turnstile, before looking at the password', async () => {
    const partner = await createPartnerLogin(test, spaceId);
    const refused = await signIn({
      email: partner.email,
      password: PASSWORD,
      turnstileToken: BAD_CAPTCHA,
    }).expect(400);
    expect(refused.body).toMatchObject({ code: 'CAPTCHA_FAILED' });
    expect(refused.headers['set-cookie']).toBeUndefined();
    await signIn({ email: partner.email, password: PASSWORD }).expect(400);
  });

  it('answers staff, candidates, unknown addresses and wrong passwords alike', async () => {
    const partner = await createPartnerLogin(test, spaceId);
    const wrong = await signIn({
      email: partner.email,
      password: 'not-the-password-123',
      turnstileToken: 'ok',
    }).expect(401);
    const nobody = await signIn({
      email: 'e2e-nobody@example.test',
      password: PASSWORD,
      turnstileToken: 'ok',
    }).expect(401);
    expect(wrong.body).toEqual(nobody.body);
    for (const role of ['SUPER_ADMIN', 'RECRUITER', 'VIEWER', 'CANDIDATE'] as const) {
      const user = await createUser(test, role);
      const refused = await signIn({
        email: user.email,
        password: PASSWORD,
        turnstileToken: 'ok',
      }).expect(401);
      expect(refused.body).toEqual(nobody.body);
      expect(refused.headers['set-cookie']).toBeUndefined();
      // Staff and candidates still sign in on the site.
      await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
    }
  });

  it('locks a partner login after 5 wrong passwords, and refuses a disabled one', async () => {
    const partner = await createPartnerLogin(test, spaceId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn({
        email: partner.email,
        password: 'wrong-password-1234',
        turnstileToken: 'ok',
      }).expect(401);
    }
    await signIn({ email: partner.email, password: PASSWORD, turnstileToken: 'ok' }).expect(401);
    await test.prisma.user.update({
      where: { id: partner.id },
      data: { lockedUntil: null, isActive: false },
    });
    await signIn({ email: partner.email, password: PASSWORD, turnstileToken: 'ok' }).expect(401);
  });

  it('sends the reset email in the space language, linking to the partner area', async () => {
    const partner = await createPartnerLogin(test, spaceId, 'e2e-partner@example.test');
    // The login's locale follows its space (set when the login is created).
    await test.prisma.user.update({ where: { id: partner.id }, data: { locale: 'pl' } });
    const forPartner = await test
      .http()
      .post(`${API}/auth/forgot-password`)
      .send({ email: partner.email, turnstileToken: 'ok' })
      .expect(202);
    const forNobody = await test
      .http()
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'e2e-nobody@example.test', turnstileToken: 'ok' })
      .expect(202);
    expect(forPartner.body).toEqual(forNobody.body);
    expect(test.outbox).toHaveLength(1);
    const email = test.outbox[0];
    expect(email?.to).toBe(partner.email);
    expect(email?.subject).toBe('Zresetuj hasło - IconBridge Jobs');
    expect(email?.text).toContain('http://localhost:3000/partners/pl/reset-password?token=');
    expect(email?.html).toContain('lang="pl"');

    // The link sets a password of the person's own, and ends every session.
    await test
      .http()
      .post(`${API}/auth/reset-password`)
      .send({ token: tokenFrom(email), password: NEW_PASSWORD })
      .expect(204);
    await test
      .http()
      .get(`${API}/partner-spaces`)
      .set('Cookie', cookieHeader(partner.cookies))
      .expect(401);
    await signIn({ email: partner.email, password: NEW_PASSWORD, turnstileToken: 'ok' }).expect(
      200,
    );
    const row = await test.prisma.user.findUniqueOrThrow({ where: { id: partner.id } });
    expect(row.passwordChangeRequired).toBe(false);
  });

  it('keeps the limit of reset emails per address', async () => {
    const partner = await createPartnerLogin(test, spaceId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await test
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ email: partner.email, turnstileToken: 'ok' })
        .expect(202);
    }
    // One every 2 minutes.
    expect(test.outbox).toHaveLength(1);
  });
});
