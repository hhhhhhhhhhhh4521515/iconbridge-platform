import { adminUserSchema } from '@iconbridge/shared';
import {
  API,
  cookieHeader,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  tokenFrom,
  type TestApp,
  type TestUser,
} from './app.js';

const NEW_PASSWORD = 'another-strong-passphrase-77';

describe('admin accounts (e2e)', () => {
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

  const as = (user: TestUser) => ({
    get: (path: string) =>
      test.http().get(`${API}${path}`).set('Cookie', cookieHeader(user.cookies)),
    post: (path: string, body: object = {}) =>
      test.http().post(`${API}${path}`).set('Cookie', cookieHeader(user.cookies)).send(body),
    patch: (path: string, body: object = {}) =>
      test.http().patch(`${API}${path}`).set('Cookie', cookieHeader(user.cookies)).send(body),
  });

  it('create -> invitation email -> set password -> sign in with the given role', async () => {
    const created = await as(root)
      .post('/admin/users', { email: 'Agent@Example.test', role: 'VIEWER', locale: 'fr' })
      .expect(201);
    const account = adminUserSchema.parse(created.body);
    expect(account).toMatchObject({
      email: 'agent@example.test',
      role: 'VIEWER',
      isActive: true,
      hasPassword: false,
      locale: 'fr',
    });
    expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|token/i);

    // Invitation email with a set-password link, in the chosen language
    expect(test.outbox).toHaveLength(1);
    expect(test.outbox[0]?.to).toBe('agent@example.test');
    expect(test.outbox[0]?.subject).toContain('Vous êtes invité(e)');
    expect(test.outbox[0]?.text).toContain('http://localhost:3000/fr/set-password?token=');

    // No password yet: cannot sign in
    await test
      .http()
      .post(`${API}/auth/login`)
      .send({ email: 'agent@example.test', password: NEW_PASSWORD })
      .expect(401);

    // Set the password with the invitation link (once)
    const token = tokenFrom(test.outbox[0]);
    await test
      .http()
      .post(`${API}/auth/reset-password`)
      .send({ token, password: NEW_PASSWORD })
      .expect(204);
    await test
      .http()
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'yet-another-passphrase-55' })
      .expect(400);

    const cookies = await login(test, 'agent@example.test', NEW_PASSWORD);
    const me = await test
      .http()
      .get(`${API}/auth/me`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(me.body).toMatchObject({ role: 'VIEWER', emailVerified: true });

    const listed = await as(root).get('/admin/users').expect(200);
    expect((listed.body as { items: { email: string; hasPassword: boolean }[] }).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'agent@example.test', hasPassword: true }),
      ]),
    );
  });

  it('gives an invitation link 72 hours', async () => {
    const created = await as(root)
      .post('/admin/users', { email: 'agent@example.test', role: 'RECRUITER' })
      .expect(201);
    const row = await test.prisma.emailToken.findFirstOrThrow({
      where: { userId: (created.body as { id: string }).id },
    });
    expect(row.type).toBe('INVITATION');
    const hours = (row.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72);
  });

  it('refuses an email that is already used, a candidate role and an invalid body', async () => {
    const candidate = await createUser(test, 'CANDIDATE');
    const taken = await as(root)
      .post('/admin/users', { email: candidate.email, role: 'VIEWER' })
      .expect(409);
    expect(taken.body).toMatchObject({ code: 'EMAIL_TAKEN' });
    await as(root).post('/admin/users', { email: 'x@example.test', role: 'CANDIDATE' }).expect(400);
    await as(root).post('/admin/users', { email: 'not-an-email', role: 'VIEWER' }).expect(400);
    expect(test.outbox).toHaveLength(0);
  });

  it('lists back-office accounts only, with pagination and a role filter', async () => {
    await createUser(test, 'CANDIDATE');
    await createUser(test, 'VIEWER');
    await createUser(test, 'RECRUITER');
    const all = await as(root).get('/admin/users').expect(200);
    const body = all.body as {
      items: { role: string }[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.total).toBe(3);
    expect(body.items.map((item) => item.role).sort()).toEqual([
      'RECRUITER',
      'SUPER_ADMIN',
      'VIEWER',
    ]);

    const viewers = await as(root).get('/admin/users?role=VIEWER').expect(200);
    expect((viewers.body as { total: number }).total).toBe(1);
    const paged = await as(root).get('/admin/users?page=2&pageSize=2').expect(200);
    expect((paged.body as { items: unknown[] }).items).toHaveLength(1);
    await as(root).get('/admin/users?pageSize=1000').expect(400);
  });

  it('changes a role, effective on the next request of that user', async () => {
    const viewer = await createUser(test, 'VIEWER');
    await as(viewer).get('/admin/users').expect(403);
    const changed = await as(root)
      .patch(`/admin/users/${viewer.id}/role`, { role: 'SUPER_ADMIN' })
      .expect(200);
    expect(changed.body).toMatchObject({ id: viewer.id, role: 'SUPER_ADMIN' });
    // Same cookies, no new login.
    await as(viewer).get('/admin/users').expect(200);
    await as(root).patch(`/admin/users/${viewer.id}/role`, { role: 'CANDIDATE' }).expect(400);
  });

  it('disable signs the account out at once and blocks login; enable restores it', async () => {
    const recruiter = await createUser(test, 'RECRUITER');
    await as(recruiter).get('/auth/me').expect(200);

    const disabled = await as(root).post(`/admin/users/${recruiter.id}/disable`).expect(200);
    expect(disabled.body).toMatchObject({ isActive: false });
    await as(recruiter).get('/auth/me').expect(401);
    await test
      .http()
      .post(`${API}/auth/refresh`)
      .set('Cookie', cookieHeader(recruiter.cookies))
      .expect(401);
    await test
      .http()
      .post(`${API}/auth/login`)
      .send({ email: recruiter.email, password: 'river-lantern-quartz-42' })
      .expect(401);

    const enabled = await as(root).post(`/admin/users/${recruiter.id}/enable`).expect(200);
    expect(enabled.body).toMatchObject({ isActive: true });
    // The old session stays dead; a new login works.
    await as(recruiter).get('/auth/me').expect(401);
    await login(test, recruiter.email);
  });

  it('force logout kills the access token and every refresh token immediately', async () => {
    const recruiter = await createUser(test, 'RECRUITER');
    const otherDevice = await login(test, recruiter.email);
    await as(root).post(`/admin/users/${recruiter.id}/force-logout`).expect(200);

    await as(recruiter).get('/auth/me').expect(401);
    await test.http().get(`${API}/auth/me`).set('Cookie', cookieHeader(otherDevice)).expect(401);
    await test
      .http()
      .post(`${API}/auth/refresh`)
      .set('Cookie', cookieHeader(otherDevice))
      .expect(401);
    // The account itself is untouched.
    await login(test, recruiter.email);
  });

  describe('safeguards', () => {
    it('a super admin cannot disable their own account', async () => {
      await createUser(test, 'SUPER_ADMIN');
      const response = await as(root).post(`/admin/users/${root.id}/disable`).expect(409);
      expect(response.body).toMatchObject({ code: 'CANNOT_DISABLE_SELF' });
      await as(root).get('/auth/me').expect(200);
    });

    it('the last super admin cannot be demoted', async () => {
      const response = await as(root)
        .patch(`/admin/users/${root.id}/role`, { role: 'RECRUITER' })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'LAST_SUPER_ADMIN' });
      expect((await test.prisma.user.findUniqueOrThrow({ where: { id: root.id } })).role).toBe(
        'SUPER_ADMIN',
      );
    });

    it('a disabled super admin does not count as a remaining one', async () => {
      const second = await createUser(test, 'SUPER_ADMIN');
      await as(root).post(`/admin/users/${second.id}/disable`).expect(200);
      await as(root).patch(`/admin/users/${root.id}/role`, { role: 'VIEWER' }).expect(409);
    });

    it('with two active super admins, one can be demoted or disabled, but not both', async () => {
      const second = await createUser(test, 'SUPER_ADMIN');
      await as(second).post(`/admin/users/${root.id}/disable`).expect(200);
      // `second` is now the last one.
      const demote = await as(second)
        .patch(`/admin/users/${second.id}/role`, { role: 'RECRUITER' })
        .expect(409);
      expect(demote.body).toMatchObject({ code: 'LAST_SUPER_ADMIN' });
      expect(await test.prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })).toBe(
        1,
      );
    });

    it('two concurrent demotions of the last two super admins leave one in place', async () => {
      const second = await createUser(test, 'SUPER_ADMIN');
      const results = await Promise.all([
        as(root).patch(`/admin/users/${second.id}/role`, { role: 'VIEWER' }),
        as(second).patch(`/admin/users/${root.id}/role`, { role: 'VIEWER' }),
      ]);
      // The loser is refused: by the rule (409), or because the winner already demoted it (403).
      expect(
        results.map((result) => result.status).filter((status) => status === 200),
      ).toHaveLength(1);
      expect(await test.prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })).toBe(
        1,
      );
    });

    it('does not manage candidate accounts or unknown ids', async () => {
      const candidate = await createUser(test, 'CANDIDATE');
      for (const id of [candidate.id, '00000000-0000-4000-8000-000000000000']) {
        await as(root).patch(`/admin/users/${id}/role`, { role: 'RECRUITER' }).expect(404);
        await as(root).post(`/admin/users/${id}/disable`).expect(404);
        await as(root).post(`/admin/users/${id}/enable`).expect(404);
        await as(root).post(`/admin/users/${id}/force-logout`).expect(404);
      }
      await as(root).post('/admin/users/not-a-uuid/disable').expect(400);
      expect((await test.prisma.user.findUniqueOrThrow({ where: { id: candidate.id } })).role).toBe(
        'CANDIDATE',
      );
    });
  });

  describe('audit log', () => {
    it('records every admin write with actor, action, record, before, after and IP', async () => {
      const created = await as(root)
        .post('/admin/users', { email: 'agent@example.test', role: 'VIEWER' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await as(root).patch(`/admin/users/${id}/role`, { role: 'RECRUITER' }).expect(200);
      await as(root).post(`/admin/users/${id}/disable`).expect(200);
      await as(root).post(`/admin/users/${id}/enable`).expect(200);
      await as(root).post(`/admin/users/${id}/force-logout`).expect(200);

      const entries = await test.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
      expect(entries.map((entry) => entry.action)).toEqual([
        'admin_user.create',
        'admin_user.change_role',
        'admin_user.disable',
        'admin_user.enable',
        'admin_user.force_logout',
      ]);
      for (const entry of entries) {
        expect(entry).toMatchObject({ actorId: root.id, entityType: 'user', entityId: id });
        expect(entry.ip).toBeTruthy();
        expect(JSON.stringify(entry)).not.toMatch(/passwordHash|argon2/);
      }
      const [create, changeRole, disable, enable, forceLogout] = entries;
      expect(create?.before).toBeNull();
      expect(create?.after).toMatchObject({ email: 'agent@example.test', role: 'VIEWER' });
      expect(changeRole?.before).toMatchObject({ role: 'VIEWER' });
      expect(changeRole?.after).toMatchObject({ role: 'RECRUITER' });
      expect(disable?.before).toMatchObject({ isActive: true });
      expect(disable?.after).toMatchObject({ isActive: false });
      expect(enable?.after).toMatchObject({ isActive: true });
      const versionBefore = (forceLogout?.before as { tokenVersion: number }).tokenVersion;
      expect(forceLogout?.after).toMatchObject({ tokenVersion: versionBefore + 1 });
    });

    it('does not record a refused action', async () => {
      await as(root).post(`/admin/users/${root.id}/disable`).expect(409);
      await as(root).post('/admin/users', { email: 'bad', role: 'VIEWER' }).expect(400);
      expect(await test.prisma.auditLog.count()).toBe(0);
    });

    it('is readable by the super admin, newest first, with the actor email', async () => {
      const created = await as(root)
        .post('/admin/users', { email: 'agent@example.test', role: 'VIEWER' })
        .expect(201);
      await as(root)
        .post(`/admin/users/${(created.body as { id: string }).id}/disable`)
        .expect(200);
      const response = await as(root).get('/admin/audit-logs?pageSize=10').expect(200);
      const body = response.body as {
        total: number;
        items: { action: string; actorEmail: string }[];
      };
      expect(body.total).toBe(2);
      expect(body.items.map((item) => item.action)).toEqual([
        'admin_user.disable',
        'admin_user.create',
      ]);
      expect(body.items[0]?.actorEmail).toBe('root@example.test');
    });
  });
});
