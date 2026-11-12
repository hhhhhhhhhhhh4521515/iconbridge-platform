import {
  partnerApplicationSchema,
  partnerHistoryPageSchema,
  partnerJobSchema,
  type UserRole,
} from '@iconbridge/shared';
import {
  API,
  cookieHeader,
  createPartnerLogin,
  createTestApp,
  createUser,
  privateKey,
  resetDatabase,
  type TestApp,
  type TestUser,
} from './app.js';
import { pdf } from './files.js';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface Space {
  id: string;
  jobId: string;
  applicationId: string;
  /** The passport of the application. */
  fileId: string;
}

interface World {
  root: TestUser;
  a: Space;
  b: Space;
  /** Members of A: its partner login, a recruiter and a viewer (same rights inside). */
  membersOfA: TestUser[];
  /** Everybody else with a session. */
  outsiders: TestUser[];
  partnerA: TestUser;
  partnerB: TestUser;
  recruiterA: TestUser;
}

/** A route of the partner area, with ids of the space it is called in. */
interface Route {
  method: Method;
  path: (s: Space) => string;
  body?: (s: Space) => object;
  /** A multipart upload in the field `file` instead of a JSON body. */
  upload?: Buffer;
  /** Answer for a member of the space. */
  ok: number;
}

const ROUTES: Route[] = [
  { method: 'get', path: (s) => `/partner-spaces/${s.id}`, ok: 200 },
  { method: 'get', path: (s) => `/partner-spaces/${s.id}/jobs`, ok: 200 },
  {
    method: 'post',
    path: (s) => `/partner-spaces/${s.id}/jobs`,
    body: () => ({ role: 'E2E Cook', positions: 1, locations: ['Kraków'] }),
    ok: 201,
  },
  { method: 'get', path: (s) => `/partner-spaces/${s.id}/jobs/${s.jobId}`, ok: 200 },
  {
    method: 'patch',
    path: (s) => `/partner-spaces/${s.id}/jobs/${s.jobId}`,
    body: () => ({ positions: 4 }),
    ok: 200,
  },
  { method: 'post', path: (s) => `/partner-spaces/${s.id}/jobs/${s.jobId}/close`, ok: 200 },
  { method: 'post', path: (s) => `/partner-spaces/${s.id}/jobs/${s.jobId}/reopen`, ok: 200 },
  { method: 'get', path: (s) => `/partner-spaces/${s.id}/jobs/${s.jobId}/comments`, ok: 200 },
  {
    method: 'post',
    path: (s) => `/partner-spaces/${s.id}/jobs/${s.jobId}/comments`,
    body: () => ({ body: 'Two more people next week' }),
    ok: 201,
  },
  { method: 'get', path: (s) => `/partner-spaces/${s.id}/applications`, ok: 200 },
  {
    method: 'post',
    path: (s) => `/partner-spaces/${s.id}/applications`,
    body: (s) => ({ jobId: s.jobId, firstName: 'Amina', lastName: 'E2E', nationality: 'MA' }),
    ok: 201,
  },
  {
    method: 'get',
    path: (s) => `/partner-spaces/${s.id}/applications/${s.applicationId}`,
    ok: 200,
  },
  {
    method: 'patch',
    path: (s) => `/partner-spaces/${s.id}/applications/${s.applicationId}`,
    body: () => ({ visaStatus: 'APPOINTMENT_BOOKED', visaAppointmentDate: '2026-12-01' }),
    ok: 200,
  },
  {
    method: 'get',
    path: (s) => `/partner-spaces/${s.id}/applications/${s.applicationId}/comments`,
    ok: 200,
  },
  {
    method: 'post',
    path: (s) => `/partner-spaces/${s.id}/applications/${s.applicationId}/comments`,
    body: () => ({ body: 'Passport received' }),
    ok: 201,
  },
  {
    method: 'put',
    path: (s) => `/partner-spaces/${s.id}/applications/${s.applicationId}/files/PASSPORT`,
    upload: pdf(),
    ok: 200,
  },
  { method: 'get', path: (s) => `/partner-spaces/${s.id}/files/${s.fileId}/link`, ok: 200 },
  {
    method: 'get',
    path: (s) => `/partner-spaces/${s.id}/files/${s.fileId}/link?inline=true`,
    ok: 200,
  },
  { method: 'get', path: (s) => `/partner-spaces/${s.id}/history`, ok: 200 },
];

describe('partner area: every route scoped to its space (IDOR e2e, ADR-027)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });

  const as = (user: TestUser | null) => {
    const cookie = user ? cookieHeader(user.cookies) : '';
    return (method: Method, path: string, body?: object) => {
      const call = test.http()[method](`${API}${path}`).set('Cookie', cookie);
      return body === undefined ? call : call.send(body);
    };
  };

  /** One route of the matrix, with its JSON body or its upload. */
  const callRoute = (user: TestUser | null, route: Route, space: Space) => {
    if (!route.upload) {
      return as(user)(route.method, route.path(space), route.body?.(space) ?? {});
    }
    return test
      .http()
      [route.method](`${API}${route.path(space)}`)
      .set('Cookie', user ? cookieHeader(user.cookies) : '')
      .attach('file', route.upload, 'passport.pdf');
  };

  const createSpace = async (name: string): Promise<Space> => {
    const space = await test.prisma.partnerSpace.create({
      data: { name, country: 'PL', defaultLocale: 'pl' },
    });
    const job = await test.prisma.partnerJob.create({
      data: {
        partnerSpaceId: space.id,
        role: `${name} Cleaner`,
        positions: 3,
        locations: ['Warsaw'],
      },
    });
    const application = await test.prisma.partnerApplication.create({
      data: {
        partnerSpaceId: space.id,
        partnerJobId: job.id,
        firstName: 'Zofia',
        lastName: `${name.replace(/\W/g, '')}Secret`,
        nationality: 'TN',
      },
    });
    const storagePath = `spaces/${space.id}/${name.replace(/\W/g, '')}-passport.pdf`;
    test.privateFiles.set(privateKey(storagePath, 'partner-files'), {
      contentType: 'application/pdf',
      content: pdf(),
    });
    const file = await test.prisma.partnerFile.create({
      data: {
        partnerSpaceId: space.id,
        partnerApplicationId: application.id,
        kind: 'PASSPORT',
        format: 'pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdf().length,
        sha256: '0'.repeat(64),
        storagePath,
        originalName: 'passport.pdf',
      },
    });
    return { id: space.id, jobId: job.id, applicationId: application.id, fileId: file.id };
  };

  const addStaff = async (spaceId: string, role: UserRole): Promise<TestUser> => {
    const user = await createUser(test, role);
    await test.prisma.partnerSpaceMember.create({
      data: { partnerSpaceId: spaceId, userId: user.id, kind: 'STAFF' },
    });
    return user;
  };

  const world = async (): Promise<World> => {
    await resetDatabase(test.prisma);
    const root = await createUser(test, 'SUPER_ADMIN', 'root@example.test');
    const a = await createSpace('E2E Alpha');
    const b = await createSpace('E2E Beta');
    const partnerA = await createPartnerLogin(test, a.id);
    const partnerB = await createPartnerLogin(test, b.id);
    const recruiterA = await addStaff(a.id, 'RECRUITER');
    const viewerA = await addStaff(a.id, 'VIEWER');
    const staffB = await addStaff(b.id, 'RECRUITER');
    return {
      root,
      a,
      b,
      partnerA,
      partnerB,
      recruiterA,
      membersOfA: [partnerA, recruiterA, viewerA],
      outsiders: [
        partnerB,
        staffB,
        root, // a super admin who is not a member sees no content
        await createUser(test, 'RECRUITER'),
        await createUser(test, 'VIEWER'),
        await createUser(test, 'COUNTRY_AGENT'),
        await createUser(test, 'CANDIDATE'),
      ],
    };
  };

  it('answers the members of a space on every route, viewers included', async () => {
    const w = await world();
    const failures: string[] = [];
    for (const member of w.membersOfA) {
      for (const route of ROUTES) {
        const response = await callRoute(member, route, w.a);
        if (response.status !== route.ok) {
          failures.push(
            `${member.role} ${route.method} ${route.path(w.a)} -> ${String(response.status)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('answers 404 to everybody else with a session, and 401 to visitors, on every route', async () => {
    const w = await world();
    const failures: string[] = [];
    for (const caller of [...w.outsiders, null]) {
      for (const route of ROUTES) {
        const response = await callRoute(caller, route, w.a);
        const expected = caller ? 404 : 401;
        if (response.status !== expected) {
          failures.push(
            `${caller?.role ?? 'visitor'} ${route.method} ${route.path(w.a)} -> ${String(response.status)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
    // Nothing was written by the refused calls.
    expect(await test.prisma.partnerJob.count({ where: { partnerSpaceId: w.a.id } })).toBe(1);
    expect(await test.prisma.partnerComment.count()).toBe(0);
    // No upload replaced the passport, and no link was recorded.
    const passport = await test.prisma.partnerFile.findUniqueOrThrow({ where: { id: w.a.fileId } });
    expect(passport.originalName).toBe('passport.pdf');
    expect(await test.prisma.partnerHistory.count({ where: { entityType: 'file' } })).toBe(0);
  });

  it('answers 404 to a member using ids of another space, in the path or in the body', async () => {
    const w = await world();
    const crossed: Space[] = [
      // Space A in the path, a job demand and an application of B.
      { id: w.a.id, jobId: w.b.jobId, applicationId: w.b.applicationId, fileId: w.b.fileId },
    ];
    const failures: string[] = [];
    for (const member of w.membersOfA) {
      for (const space of crossed) {
        for (const route of ROUTES.filter((r) =>
          r.path(space).match(/jobs\/|applications\/|files\//),
        )) {
          const response = await callRoute(member, route, space);
          if (response.status !== 404) {
            failures.push(
              `${member.role} ${route.method} ${route.path(space)} -> ${String(response.status)}`,
            );
          }
        }
        // A job demand of B in the body of a new application in A.
        const created = await as(member)('post', `/partner-spaces/${w.a.id}/applications`, {
          jobId: w.b.jobId,
          firstName: 'X',
          lastName: 'Y',
          nationality: 'MA',
        });
        if (created.status !== 404) {
          failures.push(
            `${member.role} create application with B's job -> ${String(created.status)}`,
          );
        }
      }
      // Space B in the path with B's own ids: not a member of B.
      const other = await as(member)(
        'get',
        `/partner-spaces/${w.b.id}/applications/${w.b.applicationId}`,
      );
      if (other.status !== 404) {
        failures.push(`${member.role} B's application in B -> ${String(other.status)}`);
      }
    }
    expect(failures).toEqual([]);
    const untouched = await test.prisma.partnerApplication.findUniqueOrThrow({
      where: { id: w.b.applicationId },
    });
    expect(untouched.visaStatus).toBe('NOT_STARTED');
    // B's passport was neither replaced nor linked.
    const passportB = await test.prisma.partnerFile.findUniqueOrThrow({
      where: { id: w.b.fileId },
    });
    expect(passportB.storagePath).toContain(w.b.id);
    expect(
      await test.prisma.partnerHistory.count({
        where: { partnerSpaceId: w.b.id, entityType: 'file' },
      }),
    ).toBe(0);
    expect(await test.prisma.partnerApplication.count({ where: { partnerSpaceId: w.b.id } })).toBe(
      1,
    );
    expect(await test.prisma.partnerComment.count()).toBe(0);
  });

  it('lists only the spaces of the caller', async () => {
    const w = await world();
    const mine = await as(w.partnerA)('get', '/partner-spaces').expect(200);
    expect((mine.body as { id: string }[]).map((s) => s.id)).toEqual([w.a.id]);
    const staff = await as(w.recruiterA)('get', '/partner-spaces').expect(200);
    expect(staff.body).toMatchObject([{ id: w.a.id, membership: 'STAFF' }]);
    for (const outsider of w.outsiders.filter(
      (u) => u.role !== 'PARTNER' && u.role !== 'RECRUITER',
    )) {
      const none = await as(outsider)('get', '/partner-spaces').expect(200);
      expect(none.body).toEqual([]);
    }
  });

  it('cuts access at the next request: disabled space, removed member, disabled login', async () => {
    const w = await world();
    const path = `/partner-spaces/${w.a.id}/applications/${w.a.applicationId}`;
    await as(w.recruiterA)('get', path).expect(200);
    await as(w.partnerA)('get', path).expect(200);

    await test.prisma.partnerSpace.update({ where: { id: w.a.id }, data: { isActive: false } });
    await as(w.recruiterA)('get', path).expect(404);
    await as(w.partnerA)('get', path).expect(404);
    expect((await as(w.partnerA)('get', '/partner-spaces').expect(200)).body).toEqual([]);
    await test.prisma.partnerSpace.update({ where: { id: w.a.id }, data: { isActive: true } });
    await as(w.partnerA)('get', path).expect(200);

    await test.prisma.partnerSpaceMember.delete({
      where: { partnerSpaceId_userId: { partnerSpaceId: w.a.id, userId: w.recruiterA.id } },
    });
    await as(w.recruiterA)('get', path).expect(404);

    await test.prisma.user.update({
      where: { id: w.partnerA.id },
      data: { isActive: false, tokenVersion: { increment: 1 } },
    });
    await as(w.partnerA)('get', path).expect(401);
  });

  it('records every change of every field, with the author, and checks the rules between fields', async () => {
    const w = await world();
    const call = as(w.partnerA);
    const job = partnerJobSchema.parse(
      (
        await call('patch', `/partner-spaces/${w.a.id}/jobs/${w.a.jobId}`, {
          positions: 5,
          salary: '4,500 PLN',
        }).expect(200)
      ).body,
    );
    expect(job).toMatchObject({ positions: 5, salary: '4,500 PLN' });

    const path = `/partner-spaces/${w.a.id}/applications/${w.a.applicationId}`;
    // A decision date needs a decided visa; a tracking number needs its sending date.
    await call('patch', path, { visaDecisionDate: '2026-12-10' }).expect(400);
    await call('patch', path, { dhlTrackingNumber: 'JD014600006281' }).expect(400);
    const decided = partnerApplicationSchema.parse(
      (
        await call('patch', path, {
          visaStatus: 'APPROVED',
          visaDecisionDate: '2026-12-10',
          dhlSentDate: '2026-12-12',
          dhlTrackingNumber: 'JD014600006281',
          phone: '+48123456789',
        }).expect(200)
      ).body,
    );
    expect(decided).toMatchObject({
      visaStatus: 'APPROVED',
      visaDecisionDate: '2026-12-10',
      dhlSentDate: '2026-12-12',
      updatedBy: 'Partner Person',
    });
    // Checked on the application after the change: the stored decision date stays.
    await call('patch', path, { visaStatus: 'SUBMITTED' }).expect(400);
    // Nothing changed: no entry.
    await call('patch', path, { visaStatus: 'APPROVED' }).expect(200);

    const history = partnerHistoryPageSchema.parse(
      (await call('get', `/partner-spaces/${w.a.id}/history?entityType=application`).expect(200))
        .body,
    );
    expect(
      history.items
        .map((entry) => [entry.field, entry.oldValue, entry.newValue, entry.actorName])
        .sort(),
    ).toEqual(
      [
        ['dhlSentDate', null, '2026-12-12', 'Partner Person'],
        ['dhlTrackingNumber', null, 'JD014600006281', 'Partner Person'],
        ['phone', null, '+48123456789', 'Partner Person'],
        ['visaDecisionDate', null, '2026-12-10', 'Partner Person'],
        ['visaStatus', 'NOT_STARTED', 'APPROVED', 'Partner Person'],
      ].sort(),
    );
    const jobHistory = partnerHistoryPageSchema.parse(
      (await call('get', `/partner-spaces/${w.a.id}/history?entityType=job`).expect(200)).body,
    );
    expect(
      jobHistory.items.map((entry) => [entry.field, entry.oldValue, entry.newValue]).sort(),
    ).toEqual(
      [
        ['positions', '3', '5'],
        ['salary', null, '4,500 PLN'],
      ].sort(),
    );
  });

  it('keeps comments append-only, with their author and time', async () => {
    const w = await world();
    const base = `/partner-spaces/${w.a.id}/applications/${w.a.applicationId}/comments`;
    await as(w.partnerA)('post', base, { body: '  Documents sent  ' }).expect(201);
    await as(w.recruiterA)('post', base, { body: 'Thanks' }).expect(201);
    await as(w.partnerA)('post', base, { body: '   ' }).expect(400);
    const list = await as(w.recruiterA)('get', base).expect(200);
    expect(list.body).toMatchObject([
      { authorName: 'Partner Person', body: 'Documents sent' },
      { authorName: w.recruiterA.email, body: 'Thanks' },
    ]);
    // There is no route to edit or delete a comment.
    const id = (list.body as { id: string }[])[0]?.id ?? '';
    await as(w.partnerA)('patch', `${base}/${id}`, { body: 'x' }).expect(404);
    await as(w.partnerA)('delete', `${base}/${id}`).expect(404);
  });

  describe('deleting an application (ADR-027, answer 4)', () => {
    it('is for a super admin who is a member, after typing the name; one entry without personal data remains', async () => {
      const w = await world();
      const path = `/partner-spaces/${w.a.id}/applications/${w.a.applicationId}`;
      await as(w.partnerA)('post', `${path}/comments`, { body: 'Hello' }).expect(201);
      await as(w.partnerA)('patch', path, { phone: '+48123456789' }).expect(200);
      const name = { confirmName: 'Zofia E2EAlphaSecret' };

      for (const member of w.membersOfA) {
        await as(member)('delete', path, name).expect(404);
      }
      await as(w.root)('delete', path, name).expect(404);
      await test.prisma.partnerSpaceMember.create({
        data: { partnerSpaceId: w.a.id, userId: w.root.id, kind: 'STAFF' },
      });
      const wrong = await as(w.root)('delete', path, { confirmName: 'Zofia' }).expect(400);
      expect(wrong.body).toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
      // Another space's application through A answers 404.
      await as(w.root)('delete', `/partner-spaces/${w.a.id}/applications/${w.b.applicationId}`, {
        confirmName: 'Zofia E2EBetaSecret',
      }).expect(404);

      // The storage cannot be reached: nothing is deleted, and a retry finishes the job.
      const blobsOfA = () =>
        [...test.privateFiles.keys()].filter((key) =>
          key.startsWith(`partner-files/spaces/${w.a.id}/`),
        );
      expect(blobsOfA()).toHaveLength(1);
      test.storageState.down = true;
      try {
        const down = await as(w.root)('delete', path, name).expect(503);
        expect(down.body).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
      } finally {
        test.storageState.down = false;
      }
      await as(w.partnerA)('get', path).expect(200);
      expect(blobsOfA()).toHaveLength(1);

      await as(w.root)('delete', path, name).expect(204);
      await as(w.partnerA)('get', path).expect(404);
      // The passport's blob and row are gone; B's passport stays.
      expect(blobsOfA()).toEqual([]);
      expect(await test.prisma.partnerFile.count({ where: { id: w.a.fileId } })).toBe(0);
      expect(await test.prisma.partnerFile.count({ where: { id: w.b.fileId } })).toBe(1);
      expect(
        await test.prisma.partnerComment.count({
          where: { partnerApplicationId: w.a.applicationId },
        }),
      ).toBe(0);
      const left = await test.prisma.partnerHistory.findMany({
        where: { partnerSpaceId: w.a.id, entityId: w.a.applicationId },
      });
      expect(
        left.map((entry) => [entry.action, entry.field, entry.oldValue, entry.newValue]),
      ).toEqual([['APPLICATION_DELETED', null, null, null]]);
      const everything = await test.prisma.partnerHistory.findMany({
        where: { partnerSpaceId: w.a.id },
      });
      expect(JSON.stringify(everything)).not.toMatch(/Zofia|AlphaSecret|\+48123456789/);
      const audit = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'partner_application.delete' },
      });
      expect(audit.before).toMatchObject({ comments: 1, files: 1 });
      expect(JSON.stringify(audit)).not.toMatch(/Zofia|Secret/);
      // The other space is untouched.
      expect(await test.prisma.partnerApplication.count({ where: { id: w.b.applicationId } })).toBe(
        1,
      );
    });
  });

  it('never shows partner data on the public site or in the back office', async () => {
    const w = await world();
    const secret = 'Zofia E2EAlphaSecret';
    const publicJobs = await test.http().get(`${API}/jobs?q=Alpha`).expect(200);
    expect(JSON.stringify(publicJobs.body)).not.toMatch(/E2E Alpha|AlphaSecret/);
    for (const path of [
      '/admin/applications',
      '/admin/candidates',
      '/admin/jobs',
      '/admin/stats',
    ]) {
      const response = await as(w.root)('get', path);
      expect(response.status, path).toBe(200);
      expect(JSON.stringify(response.body), path).not.toMatch(/E2E Alpha|AlphaSecret|Zofia/);
    }
    // The super admin's management routes show counts only.
    const managed = await as(w.root)('get', `/admin/partner-spaces/${w.a.id}`).expect(200);
    expect(JSON.stringify(managed.body)).not.toContain(secret.split(' ')[1]);
  });
});
