import { SESSION_MARKER_COOKIE } from '../../src/auth/auth.constants.js';
import {
  API,
  cookieAttributes,
  cookieHeader,
  cookiesFrom,
  createReadyCandidate,
  createTestApp,
  createUser,
  login,
  PASSWORD,
  resetDatabase,
  seedCatalog,
  type Cookies,
  type ReadyCandidate,
  type TestApp,
} from './app.js';

const NEW_PASSWORD = 'copper-meadow-lighthouse-77';

describe('Account settings (e2e)', () => {
  let test: TestApp;
  let candidate: ReadyCandidate;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.outbox.length = 0;
    await seedCatalog(test);
    candidate = await createReadyCandidate(test, 'amira@example.test');
  });

  const as = (cookies: Cookies) => ({
    get: (path: string) => test.http().get(`${API}${path}`).set('Cookie', cookieHeader(cookies)),
    post: (path: string) => test.http().post(`${API}${path}`).set('Cookie', cookieHeader(cookies)),
    put: (path: string) => test.http().put(`${API}${path}`).set('Cookie', cookieHeader(cookies)),
    patch: (path: string) =>
      test.http().patch(`${API}${path}`).set('Cookie', cookieHeader(cookies)),
    delete: (path: string) =>
      test.http().delete(`${API}${path}`).set('Cookie', cookieHeader(cookies)),
  });

  describe('session marker cookie', () => {
    it('is set at login, readable by the web app and holds no secret', async () => {
      const response = await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: candidate.email, password: PASSWORD })
        .expect(200);
      const attributes = cookieAttributes(response, SESSION_MARKER_COOKIE);
      expect(attributes).toContain('path=/');
      expect(attributes).toContain('secure');
      expect(attributes).toContain('samesite=lax');
      expect(attributes).not.toContain('httponly');
      const header = (response.headers['set-cookie'] as unknown as string[]).find((value) =>
        value.startsWith(`${SESSION_MARKER_COOKIE}=`),
      );
      expect(header?.split(';')[0]).toBe(`${SESSION_MARKER_COOKIE}=1`);
    });

    it('is cleared at logout', async () => {
      const response = await as(candidate.cookies).post('/auth/logout').expect(204);
      const header = (response.headers['set-cookie'] as unknown as string[]).find((value) =>
        value.startsWith(`${SESSION_MARKER_COOKIE}=`),
      );
      expect(header).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('alone gives access to nothing', async () => {
      await test
        .http()
        .get(`${API}/me/profile`)
        .set('Cookie', `${SESSION_MARKER_COOKIE}=1`)
        .expect(401);
    });
  });

  describe('PATCH /me/settings', () => {
    it('changes the language of the user', async () => {
      const response = await as(candidate.cookies)
        .patch('/me/settings')
        .send({ locale: 'ar' })
        .expect(200);
      expect(response.body).toEqual({ locale: 'ar' });
      const user = await test.prisma.user.findUniqueOrThrow({ where: { id: candidate.id } });
      expect(user.locale).toBe('ar');
      const session = await as(candidate.cookies).get('/auth/session').expect(200);
      expect((session.body as { user: { locale: string } }).user.locale).toBe('ar');
    });

    it('refuses an unknown language and visitors', async () => {
      await as(candidate.cookies).patch('/me/settings').send({ locale: 'de' }).expect(400);
      await test.http().patch(`${API}/me/settings`).send({ locale: 'en' }).expect(401);
    });

    it('is open to back-office users too', async () => {
      const viewer = await createUser(test, 'VIEWER');
      await as(viewer.cookies).patch('/me/settings').send({ locale: 'en' }).expect(200);
    });
  });

  describe('POST /me/password', () => {
    it('changes the password, signs the other sessions out and keeps this one', async () => {
      const other = await login(test, candidate.email);
      const response = await as(candidate.cookies)
        .post('/me/password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);
      const fresh = cookiesFrom(response);
      expect(fresh.access).toBeTruthy();
      expect(fresh.refresh).toBeTruthy();

      // The new cookies work, the old access tokens and refresh tokens do not.
      await as(fresh).get('/me/profile').expect(200);
      await as(candidate.cookies).get('/me/profile').expect(401);
      await as(other).get('/me/profile').expect(401);
      await as(other).post('/auth/refresh').expect(401);
      await as(fresh).post('/auth/refresh').expect(200);

      await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: candidate.email, password: PASSWORD })
        .expect(401);
      await login(test, candidate.email, NEW_PASSWORD);
    });

    it('refuses a wrong current password', async () => {
      const response = await as(candidate.cookies)
        .post('/me/password')
        .send({ currentPassword: 'not-my-password', newPassword: NEW_PASSWORD })
        .expect(403);
      expect((response.body as { code: string }).code).toBe('INVALID_CREDENTIALS');
      await as(candidate.cookies).get('/me/profile').expect(200);
    });

    it('refuses a weak new password', async () => {
      const response = await as(candidate.cookies)
        .post('/me/password')
        .send({ currentPassword: PASSWORD, newPassword: 'password1234' })
        .expect(400);
      expect((response.body as { code: string }).code).toBe('WEAK_PASSWORD');
      await login(test, candidate.email);
    });

    it('needs a session', async () => {
      await test
        .http()
        .post(`${API}/me/password`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);
    });
  });

  describe('/me/job-alerts', () => {
    it('creates an alert that is active at once, lists it and deletes it', async () => {
      const created = await as(candidate.cookies)
        .post('/me/job-alerts')
        .send({ destinations: ['malta', 'NOWHERE'], categories: [] })
        .expect(201);
      const alerts = created.body as { id: string; destinations: string[]; confirmed: boolean }[];
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ destinations: ['MALTA'], categories: [], confirmed: true });
      // No confirmation email: the address is already verified.
      expect(test.outbox).toHaveLength(0);

      const listed = await as(candidate.cookies).get('/me/job-alerts').expect(200);
      expect(listed.body).toHaveLength(1);

      await as(candidate.cookies)
        .delete(`/me/job-alerts/${alerts[0]?.id ?? ''}`)
        .expect(204);
      expect((await as(candidate.cookies).get('/me/job-alerts').expect(200)).body).toEqual([]);
    });

    it("never shows or deletes another person's alerts", async () => {
      const other = await createReadyCandidate(test, 'omar@example.test');
      const created = await as(other.cookies).post('/me/job-alerts').send({}).expect(201);
      const id = (created.body as { id: string }[])[0]?.id ?? '';

      expect((await as(candidate.cookies).get('/me/job-alerts').expect(200)).body).toEqual([]);
      await as(candidate.cookies).delete(`/me/job-alerts/${id}`).expect(404);
      expect(await test.prisma.jobAlertSubscription.count()).toBe(1);
    });

    it('is refused to a candidate whose email is not verified', async () => {
      await test.prisma.user.update({
        where: { id: candidate.id },
        data: { emailVerifiedAt: null },
      });
      const response = await as(candidate.cookies).post('/me/job-alerts').send({}).expect(403);
      expect((response.body as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('is refused to back-office users and visitors', async () => {
      const recruiter = await createUser(test, 'RECRUITER');
      await as(recruiter.cookies).get('/me/job-alerts').expect(403);
      await test.http().get(`${API}/me/job-alerts`).expect(401);
    });
  });

  describe('destination preferences', () => {
    it('are saved with the profile and returned', async () => {
      const current = (await as(candidate.cookies).get('/me/profile').expect(200)).body as Record<
        string,
        unknown
      >;
      expect(current.preferredDestinations).toEqual([]);
      // The answer carries a few read-only fields; the request is the editable ones.
      const readOnly = ['id', 'profileCompleteness', 'gdprConsentAt', 'passportNumberMasked'];
      const fields = Object.fromEntries(
        Object.entries(current).filter(([name]) => !readOnly.includes(name)),
      );
      const saved = await as(candidate.cookies)
        .put('/me/profile')
        .send({ ...fields, passportNumber: 'FAKE1234567', preferredDestinations: ['cruise_ship'] })
        .expect(200);
      expect((saved.body as { preferredDestinations: string[] }).preferredDestinations).toEqual([
        'CRUISE_SHIP',
      ]);
    });
  });

  describe('document preview', () => {
    it('asks the storage for an inline link only with ?inline=true', async () => {
      const preview = await as(candidate.cookies)
        .get(`/documents/${candidate.cvId}/download?inline=true`)
        .expect(302);
      expect(preview.headers.location).toContain('inline=1');
      const download = await as(candidate.cookies)
        .get(`/documents/${candidate.cvId}/download`)
        .expect(302);
      expect(download.headers.location).not.toContain('inline=1');
      await as(candidate.cookies)
        .get(`/documents/${candidate.cvId}/download?inline=yes`)
        .expect(400);
    });
  });
});
