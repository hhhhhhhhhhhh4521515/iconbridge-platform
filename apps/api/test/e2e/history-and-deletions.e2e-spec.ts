import { adminStatsSchema, publicStatsSchema } from '@iconbridge/shared';
import {
  API,
  cookieHeader,
  createReadyCandidate,
  createTestApp,
  createUser,
  insertJob,
  PASSWORD,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type ReadyCandidate,
  type TestApp,
  type TestUser,
} from './app.js';
import { advanceTo, applyTo, as, newApplication } from './back-office.js';
import { CatalogService } from '../../src/catalog/catalog.service.js';

const REASON = 'Duplicate record created by mistake';

describe('historical results and deletions (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let viewer: TestUser;
  let recruiter: TestUser;
  let superAdmin: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.clock.reset();
    test.privateFiles.clear();
    test.app.get(CatalogService).clearStatsCache();
    catalog = await seedCatalog(test);
    viewer = await createUser(test, 'VIEWER');
    recruiter = await createUser(test, 'RECRUITER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');
    test.outbox.length = 0;
  });

  const figure = (
    metric: string,
    value: number,
    year: number | null = null,
    destination: keyof Catalog['destinations'] | null = null,
    note?: string,
  ) => ({
    metric,
    value,
    year,
    destinationId: destination ? catalog.destinations[destination] : null,
    ...(note ? { note } : {}),
  });
  const setFigure = (body: object, user: TestUser = superAdmin) =>
    as(test, user).put('/admin/historical-figures', body);
  const adminStats = async (user: TestUser = viewer) =>
    adminStatsSchema.parse((await as(test, user).get('/admin/stats').expect(200)).body);
  const publicStats = async () =>
    publicStatsSchema.parse((await test.http().get(`${API}/stats`).expect(200)).body);

  describe('historical figures', () => {
    it('adds the history to the platform figures, per year and per destination, without mixing them', async () => {
      const year = new Date().getUTCFullYear();
      await setFigure(figure('VISAS_APPROVED', 250, 2024, 'MALTA')).expect(200);
      await setFigure(figure('VISAS_APPROVED', 40, 2024, 'POLAND')).expect(200);
      await setFigure(figure('VISAS_APPROVED', 10, 2023, 'MALTA')).expect(200);
      await setFigure(figure('VISAS_APPROVED', 5, year, 'MALTA')).expect(200);
      await setFigure(figure('CANDIDATES_DEPLOYED', 200, 2024, 'MALTA')).expect(200);
      await setFigure(figure('CANDIDATES_REGISTERED', 900, 2024, 'MALTA')).expect(200);

      // Three visas approved on the platform itself: two in Malta, one in Poland.
      const malta = await insertJob(test, catalog, { slug: 'malta', destination: 'MALTA' });
      const poland = await insertJob(test, catalog, { slug: 'poland', destination: 'POLAND' });
      for (const jobId of [malta.id, malta.id, poland.id]) {
        const { id } = await newApplication(test, jobId);
        await advanceTo(test, recruiter, id, 'VISA_APPROVED');
      }
      await newApplication(test, malta.id);

      const stats = await adminStats();
      expect(stats.history).toMatchObject({
        visasApproved: 305,
        visasApprovedThisYear: 5,
        candidatesDeployed: 200,
        registeredCandidates: 900,
        visasByYear: [
          { year: 2023, count: 10 },
          { year: 2024, count: 290 },
          { year, count: 5 },
        ],
        visasByDestination: [
          { code: 'MALTA', count: 265 },
          { code: 'POLAND', count: 40 },
        ],
      });
      expect(stats.platform).toMatchObject({
        visasApproved: 3,
        visasApprovedThisYear: 3,
        candidatesDeployed: 0,
        registeredCandidates: 4,
        visasByYear: [{ year, count: 3 }],
        visasByDestination: [
          { code: 'MALTA', count: 2 },
          { code: 'POLAND', count: 1 },
          { code: 'CRUISE_SHIP', count: 0 },
        ],
      });
      // The live figures of the dashboard are still platform data only.
      expect(stats.visasApprovedThisYear).toBe(3);
      expect(stats.applicationsByStatus.VISA_APPROVED).toBe(3);
      expect(await test.prisma.application.count()).toBe(4);

      // The site shows the sum.
      expect(await publicStats()).toMatchObject({ visasApproved: 308, registeredCandidates: 904 });
    });

    it('shows the split to recruiters and viewers, and lets only a super admin read or change the figures', async () => {
      await setFigure(figure('VISAS_APPROVED', 250, 2024, 'MALTA')).expect(200);
      for (const user of [viewer, recruiter, superAdmin]) {
        expect((await adminStats(user)).history.visasApproved).toBe(250);
      }
      for (const user of [viewer, recruiter]) {
        await setFigure(figure('VISAS_APPROVED', 1, 2024, 'MALTA'), user).expect(403);
        await as(test, user).get('/admin/historical-figures').expect(403);
      }
      const candidate = await createUser(test, 'CANDIDATE');
      await setFigure(figure('VISAS_APPROVED', 1, 2024, 'MALTA'), candidate).expect(403);
      await test.http().put(`${API}/admin/historical-figures`).send({}).expect(401);
      const [only] = (await as(test, superAdmin).get('/admin/historical-figures').expect(200))
        .body as { id: string; value: number }[];
      await as(test, recruiter)
        .delete(`/admin/historical-figures/${only?.id ?? ''}`)
        .expect(403);
      expect(only?.value).toBe(250);
    });

    it('replaces a figure instead of adding a second one, and audits before and after', async () => {
      await setFigure(figure('VISAS_APPROVED', 250, 2024, 'MALTA', 'From the 2024 report')).expect(
        200,
      );
      await setFigure(figure('VISAS_APPROVED', 260, 2024, 'MALTA')).expect(200);
      const rows = await test.prisma.historicalFigure.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.value).toBe(260);
      expect((await adminStats()).history.visasApproved).toBe(260);

      const entries = await test.prisma.auditLog.findMany({
        where: { entityType: 'historicalFigure' },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((entry) => entry.action)).toEqual([
        'historical_figure.set',
        'historical_figure.set',
      ]);
      expect(entries[0]).toMatchObject({ actorId: superAdmin.id, before: null });
      expect(entries[0]?.after).toMatchObject({
        metric: 'VISAS_APPROVED',
        year: 2024,
        destination: 'MALTA',
        value: 250,
        note: 'From the 2024 report',
      });
      expect(entries[1]?.before).toMatchObject({ value: 250 });
      expect(entries[1]?.after).toMatchObject({ value: 260, note: null });

      await as(test, superAdmin)
        .delete(`/admin/historical-figures/${rows[0]?.id ?? ''}`)
        .expect(204);
      expect((await adminStats()).history.visasApproved).toBe(0);
      const removed = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'historical_figure.delete' },
      });
      expect(removed.before).toMatchObject({ value: 260 });
      await as(test, superAdmin)
        .delete('/admin/historical-figures/00000000-0000-4000-8000-000000000000')
        .expect(404);
    });

    it('computes the public counters again as soon as a figure changes', async () => {
      const before = await publicStats();
      expect(before.visasApproved).toBe(0);
      // The answer is cached for 10 minutes...
      await test.prisma.user.create({ data: { email: 'late@example.test', role: 'CANDIDATE' } });
      expect((await publicStats()).registeredCandidates).toBe(before.registeredCandidates);
      // ...but a new figure must not wait.
      await setFigure(figure('VISAS_APPROVED', 250, 2024, 'MALTA')).expect(200);
      expect(await publicStats()).toMatchObject({
        visasApproved: 250,
        registeredCandidates: before.registeredCandidates + 1,
      });
    });

    it('adds partner companies and takes the larger number of countries', async () => {
      await insertJob(test, catalog, { slug: 'a', employerName: 'Harbour Hotels' });
      await insertJob(test, catalog, { slug: 'b', employerName: ' harbour hotels ' });
      await insertJob(test, catalog, { slug: 'c', employerName: 'Baltic Steel' });
      await insertJob(test, catalog, {
        slug: 'd',
        employerName: 'Never Published',
        status: 'DRAFT',
      });
      expect(await publicStats()).toMatchObject({ partnerCompanies: 2, countries: 3 });

      await setFigure(figure('PARTNER_COMPANIES', 35)).expect(200);
      await setFigure(figure('COUNTRIES_SERVED', 2)).expect(200);
      expect(await publicStats()).toMatchObject({ partnerCompanies: 37, countries: 3 });
      await setFigure(figure('COUNTRIES_SERVED', 9)).expect(200);
      expect(await publicStats()).toMatchObject({ countries: 9 });
      const stats = await adminStats();
      expect(stats.history).toMatchObject({ partnerCompanies: 35, countries: 9 });
      expect(stats.platform).toMatchObject({ partnerCompanies: 2, countries: 3 });
    });

    it.each([
      ['a negative value', () => figure('VISAS_APPROVED', -1, 2024, 'MALTA')],
      ['a decimal value', () => figure('VISAS_APPROVED', 1.5, 2024, 'MALTA')],
      ['a yearly figure without a destination', () => figure('VISAS_APPROVED', 1, 2024)],
      ['a yearly figure without a year', () => figure('VISAS_APPROVED', 1, null, 'MALTA')],
      ['a global figure with a year', () => figure('PARTNER_COMPANIES', 1, 2024)],
      ['a year before 1990', () => figure('VISAS_APPROVED', 1, 1980, 'MALTA')],
      ['an unknown metric', () => figure('APPLICATIONS', 1, 2024, 'MALTA')],
      [
        'an unknown destination',
        () => ({
          ...figure('VISAS_APPROVED', 1, 2024),
          destinationId: '00000000-0000-4000-8000-000000000000',
        }),
      ],
    ])('refuses %s', async (_name, body) => {
      await setFigure(body()).expect(400);
      expect(await test.prisma.historicalFigure.count()).toBe(0);
    });
  });

  describe('who may delete', () => {
    const capabilities = async (user: TestUser) =>
      (
        (await as(test, user).get('/admin/capabilities').expect(200)).body as {
          canDeleteRecords: boolean;
        }
      ).canDeleteRecords;
    const allowRecruiters = (value: boolean) =>
      as(test, superAdmin).put('/admin/settings/ALLOW_RECRUITER_DELETE', { value }).expect(200);

    it('is a super admin by default; a recruiter only when the setting is on; never a viewer', async () => {
      const job = await insertJob(test, catalog, { slug: 'job' });
      const first = await newApplication(test, job.id);
      const second = await newApplication(test, job.id);

      expect(await capabilities(superAdmin)).toBe(true);
      expect(await capabilities(recruiter)).toBe(false);
      expect(await capabilities(viewer)).toBe(false);
      for (const user of [viewer, recruiter]) {
        await as(test, user)
          .delete(`/admin/applications/${first.id}`)
          .send({ reason: REASON })
          .expect(403);
        await as(test, user)
          .delete(`/admin/candidates/${first.candidate.profileId}`)
          .send({ reason: REASON })
          .expect(403);
        await as(test, user)
          .post('/admin/applications/bulk-delete', { ids: [first.id], reason: REASON })
          .expect(403);
        await as(test, user)
          .post('/admin/candidates/bulk-delete', {
            ids: [first.candidate.profileId],
            reason: REASON,
          })
          .expect(403);
      }
      expect(await test.prisma.application.count()).toBe(2);
      expect(await test.prisma.auditLog.count({ where: { action: { endsWith: '.delete' } } })).toBe(
        0,
      );

      // Only a super admin switches the setting.
      await as(test, recruiter)
        .put('/admin/settings/ALLOW_RECRUITER_DELETE', { value: true })
        .expect(403);
      await as(test, superAdmin)
        .put('/admin/settings/ALLOW_RECRUITER_DELETE', { value: 'yes' })
        .expect(400);
      await allowRecruiters(true);
      expect(await capabilities(recruiter)).toBe(true);
      expect(await capabilities(viewer)).toBe(false);
      await as(test, recruiter)
        .delete(`/admin/applications/${first.id}`)
        .send({ reason: REASON })
        .expect(204);
      await as(test, viewer)
        .delete(`/admin/applications/${second.id}`)
        .send({ reason: REASON })
        .expect(403);

      await allowRecruiters(false);
      await as(test, recruiter)
        .delete(`/admin/applications/${second.id}`)
        .send({ reason: REASON })
        .expect(403);
      await as(test, superAdmin)
        .delete(`/admin/applications/${second.id}`)
        .send({ reason: REASON })
        .expect(204);
      await test
        .http()
        .delete(`${API}/admin/applications/${second.id}`)
        .send({ reason: REASON })
        .expect(401);
    });
  });

  describe('deleting a candidate', () => {
    let candidate: ReadyCandidate;
    let jobId: string;
    let deployedId: string;
    let activeId: string;

    beforeEach(async () => {
      jobId = (await insertJob(test, catalog, { slug: 'welder', title: 'Welder', positions: 2 }))
        .id;
      const other = await insertJob(test, catalog, { slug: 'cook', title: 'Cook' });
      candidate = await createReadyCandidate(test, 'amira.khelifi@example.test');
      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { firstName: 'Amira', lastName: 'Khelifi' },
      });
      deployedId = await applyTo(test, candidate, jobId);
      await advanceTo(test, recruiter, deployedId, 'DEPLOYED');
      activeId = await applyTo(test, candidate, other.id);
      await as(test, recruiter)
        .post(`/admin/applications/${activeId}/notes`, { body: 'Amira called on Monday' })
        .expect(201);
    });

    const remove = (reason: unknown = REASON) =>
      as(test, superAdmin).delete(`/admin/candidates/${candidate.profileId}`).send({ reason });

    it('removes the files from storage, erases the person and keeps anonymous rows for the statistics', async () => {
      const paths = [...test.privateFiles.keys()];
      expect(paths).toHaveLength(2);
      const before = await adminStats();

      const response = await remove().expect(200);
      expect(response.body).toEqual({ id: candidate.profileId, documents: 2, applications: 2 });

      // Files first: nothing of the candidate is left in the private storage.
      expect(paths.filter((path) => test.privateFiles.has(path))).toEqual([]);
      expect(
        await test.prisma.document.count({ where: { candidateId: candidate.profileId } }),
      ).toBe(0);

      const profile = await test.prisma.candidateProfile.findUniqueOrThrow({
        where: { id: candidate.profileId },
        include: { user: true },
      });
      expect(profile).toMatchObject({
        firstName: 'Deleted',
        lastName: 'User',
        phone: null,
        dateOfBirth: null,
        passportNumberEncrypted: null,
        passportNumberMasked: null,
      });
      expect(profile.user.email).toMatch(/^deleted-.*@deleted\.invalid$/);
      expect(profile.user.deletedAt).not.toBeNull();
      expect(await test.prisma.applicationNote.count()).toBe(0);
      const rows = await test.prisma.application.findMany({ orderBy: { appliedAt: 'asc' } });
      expect(rows.map((row) => [row.id, row.status])).toEqual([
        [deployedId, 'DEPLOYED'],
        [activeId, 'WITHDRAWN'],
      ]);
      expect(rows.every((row) => JSON.stringify(row.profileSnapshot) === '{}')).toBe(true);

      // The person cannot sign in and is no longer listed; the totals did not lose an application.
      await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: candidate.email, password: PASSWORD })
        .expect(401);
      await as(test, viewer).get(`/admin/candidates/${candidate.profileId}`).expect(404);
      const after = await adminStats();
      expect(after.platform.candidatesDeployed).toBe(before.platform.candidatesDeployed);
      expect(after.platform.visasApproved).toBe(before.platform.visasApproved);
      expect(after.applicationsByStatus.DEPLOYED).toBe(1);
      expect(Object.values(after.applicationsByStatus).reduce((a, b) => a + b, 0)).toBe(2);
      expect(after.platform.registeredCandidates).toBe(before.platform.registeredCandidates - 1);
      // The position stays taken.
      expect((await test.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).hiredCount).toBe(
        1,
      );
    });

    it('writes who, when, why and the counts to the audit log, and nothing personal', async () => {
      await remove('Asked by phone to be removed').expect(200);
      const entry = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'candidate.delete' },
      });
      expect(entry).toMatchObject({
        actorId: superAdmin.id,
        entityType: 'candidate',
        entityId: candidate.profileId,
        before: { documents: 2, applications: 2 },
        after: { reason: 'Asked by phone to be removed', deletedBy: 'SUPER_ADMIN' },
      });
      expect(entry.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
      // What an entry says (not its random ids: a UUID can contain "567" by chance).
      const text = JSON.stringify(
        (await test.prisma.auditLog.findMany({ where: { action: 'candidate.delete' } })).map(
          ({ action, entityType, before, after, ip }) => ({
            action,
            entityType,
            before,
            after,
            ip,
          }),
        ),
      );
      for (const personal of [
        'Amira',
        'Khelifi',
        'amira.khelifi@example.test',
        'FAKE1234567',
        '567',
        '+21612345678',
      ]) {
        expect(text).not.toContain(personal);
      }
    });

    it('needs a reason, and answers 404 for an unknown or already deleted candidate', async () => {
      await as(test, superAdmin)
        .delete(`/admin/candidates/${candidate.profileId}`)
        .send({})
        .expect(400);
      await remove('  no ').expect(400);
      expect(test.privateFiles.size).toBe(2);
      await remove().expect(200);
      await remove().expect(404);
      await as(test, superAdmin)
        .delete('/admin/candidates/00000000-0000-4000-8000-000000000000')
        .send({ reason: REASON })
        .expect(404);
    });

    it('deletes several candidates and reports the ones it could not', async () => {
      const second = await createReadyCandidate(test, 'omar@example.test');
      const response = await as(test, superAdmin)
        .post('/admin/candidates/bulk-delete', {
          ids: [candidate.profileId, '00000000-0000-4000-8000-000000000000', second.profileId],
          reason: REASON,
        })
        .expect(200);
      expect(response.body).toMatchObject({ changed: 2, failed: 1 });
      expect(
        (response.body as { results: { ok: boolean; code?: string }[] }).results[1],
      ).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      });
      expect(test.privateFiles.size).toBe(0);
      expect(await test.prisma.auditLog.count({ where: { action: 'candidate.delete' } })).toBe(2);
    });
  });

  describe('deleting an application', () => {
    let candidate: ReadyCandidate;
    let jobId: string;
    let id: string;

    beforeEach(async () => {
      jobId = (await insertJob(test, catalog, { slug: 'welder', title: 'Welder', positions: 2 }))
        .id;
      candidate = await createReadyCandidate(test, 'amira.khelifi@example.test');
      id = await applyTo(test, candidate, jobId);
    });

    const remove = (applicationId = id, reason = REASON) =>
      as(test, superAdmin).delete(`/admin/applications/${applicationId}`).send({ reason });
    const eligibility = async () =>
      (
        await test
          .http()
          .get(`${API}/jobs/${jobId}/eligibility`)
          .set('Cookie', cookieHeader(candidate.cookies))
          .expect(200)
      ).body as { canApply: boolean; reasons: string[] };

    it('removes the history and the notes with it and leaves the documents with the candidate', async () => {
      await as(test, recruiter)
        .patch(`/admin/applications/${id}/status`, { status: 'UNDER_REVIEW' })
        .expect(200);
      await as(test, recruiter)
        .post(`/admin/applications/${id}/notes`, { body: 'Called twice' })
        .expect(201);
      await remove().expect(204);

      expect(await test.prisma.application.count()).toBe(0);
      expect(await test.prisma.applicationStatusHistory.count()).toBe(0);
      expect(await test.prisma.applicationNote.count()).toBe(0);
      expect(await test.prisma.applicationDocument.count()).toBe(0);
      expect(
        await test.prisma.document.count({ where: { candidateId: candidate.profileId } }),
      ).toBe(2);
      expect(test.privateFiles.size).toBe(2);
      expect((await as(test, candidate).get('/me/applications').expect(200)).body).toEqual([]);
      await as(test, viewer).get(`/admin/applications/${id}`).expect(404);
      await remove().expect(404);
    });

    it('lifts the waiting period for that job: the candidate may apply again at once', async () => {
      expect(await eligibility()).toMatchObject({ canApply: false, reasons: ['REAPPLY_COOLDOWN'] });
      await test
        .http()
        .post(`${API}/jobs/${jobId}/apply`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .send({ documentIds: [candidate.cvId, candidate.passportId], turnstileToken: 'ok' })
        .expect(409);

      await remove().expect(204);
      expect(await eligibility()).toMatchObject({ canApply: true, reasons: [] });
      expect(await applyTo(test, candidate, jobId)).not.toBe(id);
    });

    it('does not give back the position of a deployed candidate', async () => {
      await advanceTo(test, recruiter, id, 'DEPLOYED');
      expect((await test.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).hiredCount).toBe(
        1,
      );
      await remove().expect(204);
      expect((await test.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).hiredCount).toBe(
        1,
      );
    });

    it('keeps a success story made from it, without the link', async () => {
      await advanceTo(test, recruiter, id, 'VISA_APPROVED');
      const story = (
        await as(test, recruiter).post(`/admin/success-stories/from-application/${id}`).expect(201)
      ).body as { id: string };
      await remove().expect(204);
      const kept = await test.prisma.successStory.findUniqueOrThrow({ where: { id: story.id } });
      expect(kept.applicationId).toBeNull();
    });

    it('audits the deletion with its reason and counts, without personal data', async () => {
      await as(test, recruiter)
        .post(`/admin/applications/${id}/notes`, { body: 'Amira called' })
        .expect(201);
      await remove(id, 'Applied twice by mistake').expect(204);
      const entry = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'application.delete' },
      });
      expect(entry).toMatchObject({
        actorId: superAdmin.id,
        entityType: 'application',
        entityId: id,
        before: { status: 'SUBMITTED', jobId, notes: 1, statusChanges: 1, documentsAttached: 2 },
        after: { reason: 'Applied twice by mistake', deletedBy: 'SUPER_ADMIN' },
      });
      const text = JSON.stringify(entry);
      for (const personal of [
        'Amira',
        'Khelifi',
        'amira.khelifi@example.test',
        candidate.profileId,
      ]) {
        expect(text).not.toContain(personal);
      }
      await as(test, superAdmin)
        .delete(`/admin/applications/${id}`)
        .send({ reason: 'x' })
        .expect(400);
    });

    it('deletes several applications and reports the ones it could not', async () => {
      const second = await newApplication(test, jobId);
      const response = await as(test, superAdmin)
        .post('/admin/applications/bulk-delete', {
          ids: [id, second.id, '00000000-0000-4000-8000-000000000000'],
          reason: REASON,
        })
        .expect(200);
      expect(response.body).toMatchObject({ changed: 2, failed: 1 });
      expect(await test.prisma.application.count()).toBe(0);
      expect(await test.prisma.auditLog.count({ where: { action: 'application.delete' } })).toBe(2);
      await as(test, superAdmin)
        .post('/admin/applications/bulk-delete', { ids: [], reason: REASON })
        .expect(400);
    });
  });
});
