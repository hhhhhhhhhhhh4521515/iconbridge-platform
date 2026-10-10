import {
  API,
  cookieHeader,
  createTestApp,
  createUser,
  resetDatabase,
  type TestApp,
  type TestUser,
} from './app.js';
import { AdminFixturesController, CandidateFixturesController } from './fixtures.controller.js';

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

describe('roles and ownership (e2e)', () => {
  let test: TestApp;
  let candidate: TestUser;
  let viewer: TestUser;
  let recruiter: TestUser;
  let superAdmin: TestUser;

  /** Every route under /admin that the application exposes, from its OpenAPI document. */
  let adminRoutes: { method: string; path: string }[];

  beforeAll(async () => {
    test = await createTestApp({
      controllers: [AdminFixturesController, CandidateFixturesController],
    });
    await resetDatabase(test.prisma);
    candidate = await createUser(test, 'CANDIDATE');
    viewer = await createUser(test, 'VIEWER');
    recruiter = await createUser(test, 'RECRUITER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');

    const document = (await test.http().get('/api/docs-json').expect(200)).body as {
      paths: Record<string, Record<string, unknown>>;
    };
    adminRoutes = Object.entries(document.paths)
      .filter(([path]) => path.startsWith(`${API}/admin`))
      .flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => ({
          method,
          path: path.replaceAll(/\{[^}]+\}/g, ZERO_UUID),
        })),
      );
  });
  afterAll(async () => {
    await test.close();
  });

  const call = (method: string, path: string, user?: TestUser) => {
    const agent = test.http();
    const request = (
      agent as unknown as Record<string, (url: string) => ReturnType<typeof agent.get>>
    )[method.toLowerCase()]?.call(agent, path);
    if (!request) {
      throw new Error(`Unsupported method ${method}`);
    }
    return user ? request.set('Cookie', cookieHeader(user.cookies)).send({}) : request.send({});
  };

  it('finds the real admin routes and the fixtures in the OpenAPI document', () => {
    const paths = adminRoutes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        `get ${API}/admin/users`,
        `post ${API}/admin/users`,
        `patch ${API}/admin/users/${ZERO_UUID}/role`,
        `post ${API}/admin/users/${ZERO_UUID}/disable`,
        `post ${API}/admin/users/${ZERO_UUID}/enable`,
        `post ${API}/admin/users/${ZERO_UUID}/force-logout`,
        `get ${API}/admin/audit-logs`,
      ]),
    );
    expect(adminRoutes.length).toBeGreaterThanOrEqual(15);
  });

  it('answers 401 on every admin route without a session', async () => {
    for (const route of adminRoutes) {
      const response = await call(route.method, route.path);
      expect([route.method, route.path, response.status]).toEqual([route.method, route.path, 401]);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('answers 403 to a candidate on every admin route, whatever the method', async () => {
    for (const route of adminRoutes) {
      const response = await call(route.method, route.path, candidate);
      expect([route.method, route.path, response.status]).toEqual([route.method, route.path, 403]);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('answers 403 to a viewer on every admin write', async () => {
    const writes = adminRoutes.filter((route) => route.method !== 'get');
    expect(writes.length).toBeGreaterThanOrEqual(9);
    for (const route of writes) {
      const response = await call(route.method, route.path, viewer);
      expect([route.method, route.path, response.status]).toEqual([route.method, route.path, 403]);
    }
  });

  it('changes nothing when a candidate or a viewer tries to create an admin account', async () => {
    const before = await test.prisma.user.count();
    for (const user of [candidate, viewer, recruiter]) {
      await test
        .http()
        .post(`${API}/admin/users`)
        .set('Cookie', cookieHeader(user.cookies))
        .send({ email: 'intruder@example.test', role: 'SUPER_ADMIN' })
        .expect(403);
    }
    expect(await test.prisma.user.count()).toBe(before);
    expect(test.outbox).toHaveLength(0);
  });

  describe('privileges table of the specification', () => {
    // [method, path, candidate, viewer, recruiter, super admin]
    const matrix: [string, string, number, number, number, number][] = [
      ['GET', '/admin/fixtures/candidates', 403, 200, 200, 200], // see candidates: viewer reads
      ['POST', '/admin/fixtures/candidates', 403, 403, 201, 201], // viewer is read only
      ['PUT', `/admin/fixtures/candidates/${ZERO_UUID}`, 403, 403, 200, 200],
      ['PATCH', `/admin/fixtures/candidates/${ZERO_UUID}`, 403, 403, 200, 200],
      ['DELETE', `/admin/fixtures/candidates/${ZERO_UUID}`, 403, 403, 200, 200],
      ['POST', '/admin/fixtures/jobs', 403, 403, 201, 201], // manage jobs: recruiter and super admin
      ['GET', '/admin/fixtures/settings', 403, 403, 403, 200], // settings: super admin only
      ['GET', '/admin/users', 403, 403, 403, 200], // admin accounts: super admin only
      ['GET', '/admin/audit-logs', 403, 403, 403, 200], // audit log: super admin only
      ['GET', '/admin/fixtures/forgotten', 403, 403, 403, 403], // no @Roles under /admin: closed
      ['GET', '/fixtures/any-user', 200, 200, 200, 200], // signed-in route without @Roles
      ['POST', '/fixtures/apply', 201, 403, 403, 403], // apply: candidates only
    ];

    it.each(matrix)(
      '%s %s',
      async (method, path, asCandidate, asViewer, asRecruiter, asSuperAdmin) => {
        const statuses = [];
        for (const user of [candidate, viewer, recruiter, superAdmin]) {
          statuses.push((await call(method, `${API}${path}`, user)).status);
        }
        expect(statuses).toEqual([asCandidate, asViewer, asRecruiter, asSuperAdmin]);
      },
    );
  });

  describe('verified email', () => {
    it('refuses to apply before the email is verified, and allows it after', async () => {
      const unverified = await createUser(test, 'CANDIDATE');
      await test.prisma.user.update({
        where: { id: unverified.id },
        data: { emailVerifiedAt: null },
      });
      const refused = await call('POST', `${API}/fixtures/apply`, unverified);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });

      await test.prisma.user.update({
        where: { id: unverified.id },
        data: { emailVerifiedAt: new Date() },
      });
      expect((await call('POST', `${API}/fixtures/apply`, unverified)).status).toBe(201);
    });
  });

  describe('ownership', () => {
    let other: TestUser;
    let ownDocumentId: string;
    let ownApplicationId: string;

    beforeAll(async () => {
      other = await createUser(test, 'CANDIDATE');
      const document = await test.prisma.document.create({
        data: {
          candidateId: candidate.profileId ?? '',
          type: 'CV',
          blobPath: 'test/cv.pdf',
          originalName: 'cv.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1000,
          sha256: 'a'.repeat(64),
        },
      });
      ownDocumentId = document.id;
      const destination = await test.prisma.destination.create({
        data: { code: 'MALTA', name: { en: 'Malta', fr: 'Malte', ar: 'مالطا' } },
      });
      const category = await test.prisma.jobCategory.create({
        data: { slug: 'hospitality', name: { en: 'Hospitality', fr: 'Hôtellerie', ar: 'الضيافة' } },
      });
      const job = await test.prisma.job.create({
        data: {
          title: 'Test job',
          slug: 'test-job',
          description: 'Test',
          destinationId: destination.id,
          categoryId: category.id,
          createdById: recruiter.id,
          deadline: new Date(Date.now() + 86_400_000),
        },
      });
      const application = await test.prisma.application.create({
        data: { jobId: job.id, candidateId: candidate.profileId ?? '', profileSnapshot: {} },
      });
      ownApplicationId = application.id;
    });

    it('lets a candidate read and modify their own profile, document and application', async () => {
      expect(
        (await call('GET', `${API}/fixtures/profiles/${candidate.profileId ?? ''}`, candidate))
          .status,
      ).toBe(200);
      expect(
        (await call('PATCH', `${API}/fixtures/profiles/${candidate.profileId ?? ''}`, candidate))
          .status,
      ).toBe(200);
      expect(
        (await call('GET', `${API}/fixtures/documents/${ownDocumentId}`, candidate)).status,
      ).toBe(200);
      expect(
        (await call('GET', `${API}/fixtures/applications/${ownApplicationId}`, candidate)).status,
      ).toBe(200);
    });

    it("hides another candidate's profile, document and application behind a 404", async () => {
      for (const [method, path] of [
        ['GET', `/fixtures/profiles/${candidate.profileId ?? ''}`],
        ['PATCH', `/fixtures/profiles/${candidate.profileId ?? ''}`],
        ['GET', `/fixtures/documents/${ownDocumentId}`],
        ['GET', `/fixtures/applications/${ownApplicationId}`],
      ] as const) {
        const response = await call(method, `${API}${path}`, other);
        expect([path, response.status]).toEqual([path, 404]);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    });

    it('answers the same 404 for a missing resource and for a malformed id', async () => {
      expect((await call('GET', `${API}/fixtures/profiles/${ZERO_UUID}`, candidate)).status).toBe(
        404,
      );
      expect((await call('GET', `${API}/fixtures/profiles/not-a-uuid`, candidate)).status).toBe(
        404,
      );
    });

    it('requires a session', async () => {
      expect(
        (await call('GET', `${API}/fixtures/profiles/${candidate.profileId ?? ''}`)).status,
      ).toBe(401);
    });

    it('does not restrict back-office roles, whose access is decided by @Roles', async () => {
      expect(
        (await call('GET', `${API}/fixtures/profiles/${candidate.profileId ?? ''}`, recruiter))
          .status,
      ).toBe(200);
    });
  });

  describe('audit log', () => {
    beforeEach(async () => {
      await test.prisma.auditLog.deleteMany();
    });

    it('records an admin write that has no @Audit under its method and route', async () => {
      await call('POST', `${API}/admin/fixtures/jobs`, recruiter).expect(201);
      const entries = await test.prisma.auditLog.findMany();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: recruiter.id,
        action: `POST ${API}/admin/fixtures/jobs`,
        entityType: 'unknown',
        entityId: 'not-a-uuid',
      });
      expect(entries[0]?.ip).toBeTruthy();
    });

    it('stores before and after snapshots for an audited record, without secrets', async () => {
      await call('POST', `${API}/admin/fixtures/users/${viewer.id}/touch`, recruiter).expect(201);
      const entry = await test.prisma.auditLog.findFirstOrThrow();
      expect(entry).toMatchObject({
        action: 'fixture.touch_user',
        entityType: 'user',
        entityId: viewer.id,
      });
      expect(entry.before).toMatchObject({
        id: viewer.id,
        email: viewer.email,
        role: 'VIEWER',
        isActive: true,
      });
      expect(entry.after).toMatchObject({ id: viewer.id, role: 'VIEWER' });
      expect(JSON.stringify(entry)).not.toMatch(/passwordHash|argon2|tokenHash/);
    });

    it('records nothing for reads, refused writes and candidate writes', async () => {
      await call('GET', `${API}/admin/fixtures/candidates`, recruiter).expect(200);
      await call('POST', `${API}/admin/fixtures/candidates`, viewer).expect(403);
      await call('POST', `${API}/admin/fixtures/jobs`, candidate).expect(403);
      await call('POST', `${API}/fixtures/apply`, candidate).expect(201);
      expect(await test.prisma.auditLog.count()).toBe(0);
    });
  });
});
