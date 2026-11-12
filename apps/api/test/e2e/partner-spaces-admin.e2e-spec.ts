import {
  partnerLoginSchema,
  partnerSpaceSchema,
  partnerStaffMemberSchema,
} from '@iconbridge/shared';
import { z } from 'zod';
import {
  API,
  BAD_CAPTCHA,
  cookieHeader,
  createPartnerLogin,
  createTestApp,
  createUser,
  PASSWORD,
  resetDatabase,
  sessionFor,
  type TestApp,
  type TestUser,
} from './app.js';

const NEW_PASSWORD = 'harbour-violet-copper-58';

describe('partner spaces: management by the super admin (e2e, ADR-027)', () => {
  let test: TestApp;
  let root: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.outbox.length = 0;
    root = await createUser(test, 'SUPER_ADMIN', 'root@example.test');
  });

  const as = (user: TestUser | null) => {
    const cookie = user ? cookieHeader(user.cookies) : '';
    const send = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) => {
      const call = test.http()[method](`${API}${path}`).set('Cookie', cookie);
      return body === undefined ? call : call.send(body);
    };
    return {
      get: (path: string) => send('get', path),
      post: (path: string, body: object = {}) => send('post', path, body),
      patch: (path: string, body: object = {}) => send('patch', path, body),
      delete: (path: string, body?: object) => send('delete', path, body),
    };
  };

  const createSpace = async (name = 'E2E Clean Co', defaultLocale = 'pl') =>
    partnerSpaceSchema.parse(
      (
        await as(root)
          .post('/admin/partner-spaces', { name, country: 'PL', defaultLocale })
          .expect(201)
      ).body,
    );

  /** Rows of a space's content, inserted directly: the routes that write them come in PR 2. */
  const fillSpace = async (spaceId: string) => {
    const job = await test.prisma.partnerJob.create({
      data: { partnerSpaceId: spaceId, role: 'E2E Cleaner', positions: 2, locations: ['Warsaw'] },
    });
    const application = await test.prisma.partnerApplication.create({
      data: {
        partnerSpaceId: spaceId,
        partnerJobId: job.id,
        firstName: 'Zofia',
        lastName: 'Secretname',
        nationality: 'TN',
      },
    });
    await test.prisma.partnerComment.create({
      data: {
        partnerSpaceId: spaceId,
        partnerApplicationId: application.id,
        authorName: 'x',
        body: 'Hello',
      },
    });
    return { job, application };
  };

  describe('spaces', () => {
    it('creates, lists, reads and changes a space, with counts and never its content', async () => {
      const space = await createSpace();
      expect(space).toMatchObject({
        name: 'E2E Clean Co',
        country: 'PL',
        defaultLocale: 'pl',
        isActive: true,
        hasLogo: false,
        isMember: false,
        counts: { staffMembers: 0, partnerLogins: 0, jobs: 0, applications: 0, files: 0 },
      });
      await fillSpace(space.id);

      const read = await as(root).get(`/admin/partner-spaces/${space.id}`).expect(200);
      expect(read.body).toMatchObject({ counts: { jobs: 1, applications: 1 } });
      expect(JSON.stringify(read.body)).not.toMatch(/Zofia|Secretname|E2E Cleaner|Warsaw/);
      const list = await as(root).get('/admin/partner-spaces').expect(200);
      expect(
        z
          .array(partnerSpaceSchema)
          .parse(list.body)
          .map((s) => s.name),
      ).toEqual(['E2E Clean Co']);
      expect(JSON.stringify(list.body)).not.toMatch(/Zofia|Secretname/);

      const changed = await as(root)
        .patch(`/admin/partner-spaces/${space.id}`, { name: 'E2E Clean Company', isActive: false })
        .expect(200);
      expect(changed.body).toMatchObject({ name: 'E2E Clean Company', isActive: false });

      const history = await test.prisma.partnerHistory.findMany({
        where: { partnerSpaceId: space.id, action: 'SPACE_UPDATED' },
        orderBy: { field: 'asc' },
      });
      expect(history.map((row) => [row.field, row.oldValue, row.newValue, row.actorName])).toEqual([
        ['isActive', 'true', 'false', 'root@example.test'],
        ['name', 'E2E Clean Co', 'E2E Clean Company', 'root@example.test'],
      ]);
      const audit = await test.prisma.auditLog.findMany({
        where: { entityType: 'partner_space', entityId: space.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((entry) => entry.action)).toEqual([
        'partner_space.create',
        'partner_space.update',
      ]);
    });

    it('refuses a name already used, ignoring case, and an invalid body', async () => {
      await createSpace('E2E Clean Co');
      const taken = await as(root)
        .post('/admin/partner-spaces', { name: 'e2e clean co', country: 'PL', defaultLocale: 'en' })
        .expect(409);
      expect(taken.body).toMatchObject({ code: 'PARTNER_SPACE_NAME_TAKEN' });
      const other = await createSpace('E2E Other Co');
      await as(root)
        .patch(`/admin/partner-spaces/${other.id}`, { name: 'E2E CLEAN CO' })
        .expect(409);
      for (const body of [
        { name: 'E2E X', country: 'Poland', defaultLocale: 'pl' },
        { name: 'E2E X', country: 'PL', defaultLocale: 'ar' },
        { name: 'E2E X', country: 'PL' },
      ]) {
        await as(root).post('/admin/partner-spaces', body).expect(400);
      }
      await as(root).patch(`/admin/partner-spaces/${other.id}`, {}).expect(400);
    });

    it('answers 404 for an unknown space on every management route', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      await as(root).get(`/admin/partner-spaces/${unknown}`).expect(404);
      await as(root).patch(`/admin/partner-spaces/${unknown}`, { isActive: false }).expect(404);
      await as(root).get(`/admin/partner-spaces/${unknown}/members`).expect(404);
      await as(root).get(`/admin/partner-spaces/${unknown}/logins`).expect(404);
      await as(root)
        .post(`/admin/partner-spaces/${unknown}/logins`, {
          email: 'e2e-x@example.test',
          displayName: 'X',
          password: NEW_PASSWORD,
        })
        .expect(404);
      await as(root).delete(`/admin/partner-spaces/${unknown}`, { confirmName: 'x' }).expect(404);
    });
  });

  describe('staff members', () => {
    it('adds any back-office role, once, and removes it; the space history shows who and when', async () => {
      const space = await createSpace();
      const viewer = await createUser(test, 'VIEWER', 'viewer@example.test');
      const added = await as(root)
        .post(`/admin/partner-spaces/${space.id}/members`, { userId: viewer.id })
        .expect(201);
      expect(z.array(partnerStaffMemberSchema).parse(added.body)).toMatchObject([
        { userId: viewer.id, role: 'VIEWER', email: 'viewer@example.test' },
      ]);
      // Adding again changes nothing.
      await as(root)
        .post(`/admin/partner-spaces/${space.id}/members`, { userId: viewer.id })
        .expect(201);
      // The super admin adds themselves to see the content.
      await as(root)
        .post(`/admin/partner-spaces/${space.id}/members`, { userId: root.id })
        .expect(201);
      const read = await as(root).get(`/admin/partner-spaces/${space.id}`).expect(200);
      expect(read.body).toMatchObject({ isMember: true, counts: { staffMembers: 2 } });

      await as(root).delete(`/admin/partner-spaces/${space.id}/members/${viewer.id}`).expect(204);
      await as(root).delete(`/admin/partner-spaces/${space.id}/members/${viewer.id}`).expect(404);
      const members = await as(root).get(`/admin/partner-spaces/${space.id}/members`).expect(200);
      expect((members.body as { userId: string }[]).map((m) => m.userId)).toEqual([root.id]);

      const history = await test.prisma.partnerHistory.findMany({
        where: { partnerSpaceId: space.id, entityType: 'member' },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((row) => [row.action, row.oldValue, row.newValue])).toEqual([
        ['MEMBER_ADDED', null, 'viewer@example.test'],
        ['MEMBER_ADDED', null, 'root@example.test'],
        ['MEMBER_REMOVED', 'viewer@example.test', null],
      ]);
    });

    it('refuses a candidate, a partner login, a disabled account and an unknown id', async () => {
      const space = await createSpace();
      const candidate = await createUser(test, 'CANDIDATE');
      const partner = await createPartnerLogin(test, space.id);
      const disabled = await createUser(test, 'RECRUITER');
      await test.prisma.user.update({ where: { id: disabled.id }, data: { isActive: false } });
      for (const userId of [
        candidate.id,
        partner.id,
        disabled.id,
        '00000000-0000-4000-8000-000000000000',
      ]) {
        const response = await as(root)
          .post(`/admin/partner-spaces/${space.id}/members`, { userId })
          .expect(400);
        expect(response.body).toMatchObject({ code: 'NOT_A_STAFF_ACCOUNT' });
      }
    });
  });

  describe('partner logins', () => {
    it('creates a login with "set the password now", in the space language, never returning the password', async () => {
      const space = await createSpace('E2E Clean Co', 'pl');
      const created = await as(root)
        .post(`/admin/partner-spaces/${space.id}/logins`, {
          email: 'E2E-Anna@Example.test',
          displayName: 'Anna K.',
          password: NEW_PASSWORD,
        })
        .expect(201);
      const loginBody = partnerLoginSchema.parse(created.body);
      expect(loginBody).toMatchObject({
        email: 'e2e-anna@example.test',
        displayName: 'Anna K.',
        isActive: true,
        passwordChangeRequired: true,
      });
      expect(JSON.stringify(created.body)).not.toMatch(/password"|passwordHash|harbour/);
      const row = await test.prisma.user.findUniqueOrThrow({
        where: { id: loginBody.id },
        include: { partnerMemberships: true },
      });
      expect(row).toMatchObject({ role: 'PARTNER', locale: 'pl' });
      expect(row.partnerMemberships).toMatchObject([{ partnerSpaceId: space.id, kind: 'PARTNER' }]);
      expect(test.outbox).toHaveLength(0);

      const audit = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'partner_login.create' },
      });
      expect(audit.entityId).toBe(loginBody.id);
      expect(JSON.stringify(audit)).not.toMatch(/harbour|passwordHash/);

      // The space's language changes: the login's emails follow.
      await as(root)
        .patch(`/admin/partner-spaces/${space.id}`, { defaultLocale: 'fr' })
        .expect(200);
      expect(
        (await test.prisma.user.findUniqueOrThrow({ where: { id: loginBody.id } })).locale,
      ).toBe('fr');

      const list = await as(root).get(`/admin/partner-spaces/${space.id}/logins`).expect(200);
      expect((list.body as { id: string }[]).map((l) => l.id)).toEqual([loginBody.id]);
    });

    it('refuses an address in use, a weak password, and a login of another space', async () => {
      const space = await createSpace('E2E Clean Co');
      const other = await createSpace('E2E Other Co');
      await createUser(test, 'CANDIDATE', 'e2e-taken@example.test');
      const taken = await as(root)
        .post(`/admin/partner-spaces/${space.id}/logins`, {
          email: 'e2e-taken@example.test',
          displayName: 'X',
          password: NEW_PASSWORD,
        })
        .expect(409);
      expect(taken.body).toMatchObject({ code: 'EMAIL_TAKEN' });
      const weak = await as(root)
        .post(`/admin/partner-spaces/${space.id}/logins`, {
          email: 'e2e-weak@example.test',
          displayName: 'X',
          password: 'password1234',
        })
        .expect(400);
      expect(weak.body).toMatchObject({ code: 'WEAK_PASSWORD' });

      const partnerOfOther = await createPartnerLogin(test, other.id);
      await as(root)
        .patch(`/admin/partner-spaces/${space.id}/logins/${partnerOfOther.id}`, { isActive: false })
        .expect(404);
      await as(root)
        .post(`/admin/partner-spaces/${space.id}/logins/${partnerOfOther.id}/password`, {
          password: NEW_PASSWORD,
        })
        .expect(404);
      // A staff account is not a partner login either.
      await as(root)
        .patch(`/admin/partner-spaces/${space.id}/logins/${root.id}`, { isActive: false })
        .expect(404);
    });

    it('cuts access at once when a login is disabled, and when a new password is set', async () => {
      const space = await createSpace();
      const partner = await createPartnerLogin(test, space.id);
      await as(partner).get('/auth/me').expect(200);

      await as(root)
        .patch(`/admin/partner-spaces/${space.id}/logins/${partner.id}`, { isActive: false })
        .expect(200);
      await as(partner).get('/auth/me').expect(401);
      await test
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookieHeader(partner.cookies))
        .expect(401);
      expect(
        await test.prisma.refreshToken.count({ where: { userId: partner.id, revokedAt: null } }),
      ).toBe(0);

      await as(root)
        .patch(`/admin/partner-spaces/${space.id}/logins/${partner.id}`, { isActive: true })
        .expect(200);
      const again: TestUser = { ...partner, cookies: await sessionFor(test, partner.id) };
      await as(again).get('/auth/me').expect(200);
      const set = await as(root)
        .post(`/admin/partner-spaces/${space.id}/logins/${partner.id}/password`, {
          password: NEW_PASSWORD,
        })
        .expect(200);
      expect(set.body).toMatchObject({ passwordChangeRequired: true });
      await as(again).get('/auth/me').expect(401);
      const history = await test.prisma.partnerHistory.findMany({
        where: { partnerSpaceId: space.id, entityType: 'login' },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((row) => [row.action, row.field, row.newValue])).toEqual([
        ['LOGIN_UPDATED', 'isActive', 'false'],
        ['LOGIN_UPDATED', 'isActive', 'true'],
        ['LOGIN_PASSWORD_SET', null, null],
      ]);
    });
  });

  describe('who may manage', () => {
    it('refuses every back-office role but the super admin, candidates and partner logins', async () => {
      const space = await createSpace();
      const callers = [
        await createUser(test, 'VIEWER'),
        await createUser(test, 'COUNTRY_AGENT'),
        await createUser(test, 'RECRUITER'),
        await createUser(test, 'CANDIDATE'),
        await createPartnerLogin(test, space.id),
      ];
      const routes: [string, 'get' | 'post' | 'patch' | 'delete', object?][] = [
        ['/admin/partner-spaces', 'get'],
        ['/admin/partner-spaces', 'post', { name: 'E2E Y', country: 'PL', defaultLocale: 'pl' }],
        [`/admin/partner-spaces/${space.id}`, 'get'],
        [`/admin/partner-spaces/${space.id}`, 'patch', { isActive: false }],
        [`/admin/partner-spaces/${space.id}`, 'delete', { confirmName: space.name }],
        [`/admin/partner-spaces/${space.id}/members`, 'get'],
        [`/admin/partner-spaces/${space.id}/members`, 'post', { userId: root.id }],
        [`/admin/partner-spaces/${space.id}/members/${root.id}`, 'delete'],
        [`/admin/partner-spaces/${space.id}/logins`, 'get'],
        [
          `/admin/partner-spaces/${space.id}/logins`,
          'post',
          { email: 'e2e-z@example.test', displayName: 'Z', password: NEW_PASSWORD },
        ],
        [`/admin/partner-spaces/${space.id}/logins/${root.id}`, 'patch', { isActive: false }],
        [
          `/admin/partner-spaces/${space.id}/logins/${root.id}/password`,
          'post',
          { password: NEW_PASSWORD },
        ],
      ];
      const failures: string[] = [];
      for (const caller of [...callers, null]) {
        for (const [path, method, body] of routes) {
          const response = await as(caller)[method](path, body ?? {});
          const expected = caller ? 403 : 401;
          if (response.status !== expected) {
            failures.push(
              `${caller?.role ?? 'anonymous'} ${method} ${path} -> ${String(response.status)}`,
            );
          }
        }
      }
      expect(failures).toEqual([]);
      expect(await test.prisma.partnerSpace.count()).toBe(1);
    });
  });

  describe('a partner login is fenced off (ADR-027, rule 2)', () => {
    it('reaches its own session and password change only', async () => {
      const space = await createSpace();
      const partner = await createPartnerLogin(test, space.id);
      await test.prisma.user.update({
        where: { id: partner.id },
        data: { passwordChangeRequired: true },
      });
      const me = await as(partner).get('/auth/me').expect(200);
      expect(me.body).toMatchObject({ role: 'PARTNER', passwordChangeRequired: true });
      for (const [method, path] of [
        ['get', '/me/profile'],
        ['patch', '/me/settings'],
        ['get', '/me/job-alerts'],
        ['get', '/me/applications'],
        ['get', '/admin/settings'],
        ['get', '/admin/candidates'],
      ] as const) {
        const response = await as(partner)[method](path, {});
        expect(response.status, `${method} ${path}`).toBe(403);
      }
      await as(partner)
        .post('/me/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);
      const row = await test.prisma.user.findUniqueOrThrow({ where: { id: partner.id } });
      expect(row.passwordChangeRequired).toBe(false);
    });

    it('cannot sign in through /auth/login, which answers exactly as for a wrong password', async () => {
      const space = await createSpace();
      const partner = await createPartnerLogin(test, space.id, 'e2e-partner@example.test');
      const asPartner = await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: partner.email, password: PASSWORD })
        .expect(401);
      const wrong = await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@example.test', password: PASSWORD })
        .expect(401);
      expect(asPartner.body).toEqual(wrong.body);
      expect(asPartner.headers['set-cookie']).toBeUndefined();
      // Not counted as a failed attempt: the account is not locked by this endpoint.
      const row = await test.prisma.user.findUniqueOrThrow({ where: { id: partner.id } });
      expect(row.failedLoginCount).toBe(0);
    });

    it('gets the usual answer and no email from forgot-password and resend-verification', async () => {
      const space = await createSpace();
      const partner = await createPartnerLogin(test, space.id, 'e2e-partner@example.test');
      for (const path of ['/auth/forgot-password', '/auth/resend-verification']) {
        const forPartner = await test
          .http()
          .post(`${API}${path}`)
          .send({ email: partner.email, turnstileToken: 'ok' });
        const forNobody = await test
          .http()
          .post(`${API}${path}`)
          .send({ email: 'nobody@example.test', turnstileToken: 'ok' });
        expect(forPartner.status).toBe(forNobody.status);
        expect(forPartner.body).toEqual(forNobody.body);
        await test
          .http()
          .post(`${API}${path}`)
          .send({ email: partner.email, turnstileToken: BAD_CAPTCHA })
          .expect(400);
      }
      expect(test.outbox).toHaveLength(0);
    });
  });

  describe('deleting a space (GDPR)', () => {
    it('needs the exact name, then deletes every row and the partner logins, keeping the staff', async () => {
      const space = await createSpace('E2E Clean Co');
      const keep = await createSpace('E2E Other Co');
      const viewer = await createUser(test, 'VIEWER');
      await as(root)
        .post(`/admin/partner-spaces/${space.id}/members`, { userId: viewer.id })
        .expect(201);
      const partner = await createPartnerLogin(test, space.id);
      const otherPartner = await createPartnerLogin(test, keep.id);
      await fillSpace(space.id);
      await fillSpace(keep.id);

      for (const confirmName of ['E2E Clean', 'e2e clean co', 'E2E Other Co']) {
        const refused = await as(root)
          .delete(`/admin/partner-spaces/${space.id}`, { confirmName })
          .expect(400);
        expect(refused.body).toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
      }
      await as(root).delete(`/admin/partner-spaces/${space.id}`, {}).expect(400);
      expect(await test.prisma.partnerSpace.count()).toBe(2);

      await as(root)
        .delete(`/admin/partner-spaces/${space.id}`, { confirmName: 'E2E Clean Co' })
        .expect(204);

      const where = { partnerSpaceId: space.id };
      expect(await test.prisma.partnerSpace.count({ where: { id: space.id } })).toBe(0);
      expect(await test.prisma.partnerSpaceMember.count({ where })).toBe(0);
      expect(await test.prisma.partnerJob.count({ where })).toBe(0);
      expect(await test.prisma.partnerApplication.count({ where })).toBe(0);
      expect(await test.prisma.partnerComment.count({ where })).toBe(0);
      expect(await test.prisma.partnerHistory.count({ where })).toBe(0);
      expect(await test.prisma.user.count({ where: { id: partner.id } })).toBe(0);
      expect(await test.prisma.refreshToken.count({ where: { userId: partner.id } })).toBe(0);
      // The staff account stays; the other space is untouched.
      expect(await test.prisma.user.count({ where: { id: viewer.id } })).toBe(1);
      expect(
        await test.prisma.partnerApplication.count({ where: { partnerSpaceId: keep.id } }),
      ).toBe(1);
      expect(await test.prisma.user.count({ where: { id: otherPartner.id } })).toBe(1);
      await as(partner).get('/auth/me').expect(401);

      const audit = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'partner_space.delete' },
      });
      expect(audit).toMatchObject({
        actorId: root.id,
        entityType: 'partner_space',
        entityId: space.id,
      });
      expect(audit.before).toEqual({
        staffMembers: 1,
        partnerLogins: 1,
        jobs: 1,
        applications: 1,
        files: 0,
        blobs: 0,
      });
      expect(JSON.stringify(audit)).not.toMatch(/Clean|Zofia|Secretname|e2e-partner/);
    });
  });

  describe('rules of the database', () => {
    it('refuses an application of one space attached to a job demand of another', async () => {
      const a = await createSpace('E2E A');
      const b = await createSpace('E2E B');
      const { job } = await fillSpace(a.id);
      await expect(
        test.prisma.partnerApplication.create({
          data: {
            partnerSpaceId: b.id,
            partnerJobId: job.id,
            firstName: 'X',
            lastName: 'Y',
            nationality: 'TN',
          },
        }),
      ).rejects.toThrow();
      await expect(
        test.prisma.partnerComment.create({
          data: { partnerSpaceId: b.id, partnerJobId: job.id, authorName: 'x', body: 'Hi' },
        }),
      ).rejects.toThrow();
    });

    it('gives a partner login one space at most, and Polish to partner logins only', async () => {
      const a = await createSpace('E2E A');
      const b = await createSpace('E2E B');
      const partner = await createPartnerLogin(test, a.id);
      await expect(
        test.prisma.partnerSpaceMember.create({
          data: { partnerSpaceId: b.id, userId: partner.id, kind: 'PARTNER' },
        }),
      ).rejects.toThrow();
      await test.prisma.user.update({ where: { id: partner.id }, data: { locale: 'pl' } });
      await expect(
        test.prisma.user.update({ where: { id: root.id }, data: { locale: 'pl' } }),
      ).rejects.toThrow();
    });
  });
});
