import { UTCDate } from '@date-fns/utc';
import {
  candidateApplicationSchema,
  eligibilitySchema,
  type ApplicationStatus,
} from '@iconbridge/shared';
import { addDays, addMonths } from 'date-fns';
import {
  API,
  BAD_CAPTCHA,
  cookieHeader,
  createReadyCandidate,
  createTestApp,
  createUser,
  daysFromNow,
  insertJob,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type ReadyCandidate,
  type TestApp,
} from './app.js';

describe('applications (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let candidate: ReadyCandidate;
  let jobId: string;
  let otherJobId: string;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.outbox.length = 0;
    test.privateFiles.clear();
    test.clock.reset();
    catalog = await seedCatalog(test);
    candidate = await createReadyCandidate(test);
    // Deadlines far ahead: several tests move the application clock by months.
    jobId = (
      await insertJob(test, catalog, {
        slug: 'receptionist',
        title: 'Hotel Receptionist',
        deadline: daysFromNow(900),
      })
    ).id;
    otherJobId = (
      await insertJob(test, catalog, {
        slug: 'cook',
        title: 'Line Cook',
        deadline: daysFromNow(900),
      })
    ).id;
  });

  const body = (who: ReadyCandidate = candidate, overrides: object = {}) => ({
    documentIds: [who.cvId, who.passportId],
    coverLetter: 'I would like to join your team.',
    turnstileToken: 'ok',
    ...overrides,
  });
  const apply = (job = jobId, who: ReadyCandidate = candidate, overrides: object = {}) =>
    test
      .http()
      .post(`${API}/jobs/${job}/apply`)
      .set('Cookie', cookieHeader(who.cookies))
      .send(body(who, overrides));
  const eligibility = async (job = jobId, who: ReadyCandidate = candidate) =>
    eligibilitySchema.parse(
      (
        await test
          .http()
          .get(`${API}/jobs/${job}/eligibility`)
          .set('Cookie', cookieHeader(who.cookies))
          .expect(200)
      ).body,
    );
  const count = () => test.prisma.application.count();
  /** Moves the latest application of the candidate to a status, as a recruiter would. */
  const setStatus = async (status: ApplicationStatus, job = jobId) => {
    const application = await test.prisma.application.findFirstOrThrow({
      where: { jobId: job, candidateId: candidate.profileId },
      orderBy: { appliedAt: 'desc' },
    });
    await test.prisma.application.update({ where: { id: application.id }, data: { status } });
    return application.id;
  };

  describe('applying', () => {
    it('creates the application with its documents, history and a snapshot of the profile', async () => {
      const response = await apply().expect(201);
      const application = candidateApplicationSchema.parse(response.body);
      expect(application).toMatchObject({
        status: 'SUBMITTED',
        canWithdraw: true,
        coverLetter: 'I would like to join your team.',
        job: {
          id: jobId,
          slug: 'receptionist',
          title: 'Hotel Receptionist',
          destinationCode: 'MALTA',
        },
      });
      expect(application.documents.map((document) => document.type).sort()).toEqual([
        'CV',
        'PASSPORT',
      ]);
      expect(application.history).toEqual([
        { fromStatus: null, toStatus: 'SUBMITTED', at: application.appliedAt },
      ]);

      const row = await test.prisma.application.findUniqueOrThrow({
        where: { id: application.id },
        include: { statusHistory: true, documents: true },
      });
      expect(row.candidateId).toBe(candidate.profileId);
      expect(row.statusHistory[0]).toMatchObject({
        toStatus: 'SUBMITTED',
        changedById: candidate.id,
      });
      expect(row.documents).toHaveLength(2);

      const snapshot = row.profileSnapshot as Record<string, unknown>;
      expect(snapshot).toMatchObject({
        firstName: 'Test',
        nationality: 'TN',
        passportNumberMasked: '********567',
        languages: [{ language: 'en', level: 'B2' }],
      });
      expect(
        (snapshot['documents'] as { type: string }[]).map((document) => document.type).sort(),
      ).toEqual(['CV', 'PASSPORT']);
      // Never the clear or the encrypted number.
      expect(JSON.stringify(snapshot)).not.toContain('FAKE1234567');
      expect(JSON.stringify(snapshot)).not.toContain('v1.');
    });

    it('keeps the snapshot as it was when the profile changes afterwards', async () => {
      const { id } = (await apply().expect(201)).body as { id: string };
      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { city: 'Sfax', firstName: 'Changed' },
      });
      const row = await test.prisma.application.findUniqueOrThrow({ where: { id } });
      expect(row.profileSnapshot).toMatchObject({ city: 'Tunis', firstName: 'Test' });
    });

    it('emails a confirmation to the candidate and a notice to recruiters and super admins', async () => {
      const recruiter = await createUser(test, 'RECRUITER');
      const superAdmin = await createUser(test, 'SUPER_ADMIN');
      const viewer = await createUser(test, 'VIEWER');
      await test.prisma.user.update({ where: { id: superAdmin.id }, data: { locale: 'fr' } });
      await test.prisma.user.create({
        data: { email: 'disabled@example.test', role: 'RECRUITER', isActive: false },
      });
      test.outbox.length = 0;

      const { id } = (await apply().expect(201)).body as { id: string };

      const byRecipient = new Map(test.outbox.map((email) => [email.to, email]));
      expect([...byRecipient.keys()].sort()).toEqual(
        [candidate.email, recruiter.email, superAdmin.email].sort(),
      );
      expect(byRecipient.has(viewer.email)).toBe(false);
      expect(byRecipient.get(candidate.email)?.subject).toContain('We received your application');
      expect(byRecipient.get(candidate.email)?.text).toContain('Hotel Receptionist');
      expect(byRecipient.get(recruiter.email)?.subject).toBe(
        'New application: Hotel Receptionist - IconBridge Jobs',
      );
      expect(byRecipient.get(recruiter.email)?.text).toContain(`/en/admin/applications/${id}`);
      expect(byRecipient.get(superAdmin.email)?.subject).toContain('Nouvelle candidature');
      // The notice carries no personal data of the candidate.
      const notice = JSON.stringify(byRecipient.get(recruiter.email));
      expect(notice).not.toContain(candidate.email);
      expect(notice).not.toContain('Candidate');
    });

    it('sends no email when the application is refused', async () => {
      await apply().expect(201);
      test.outbox.length = 0;
      await apply().expect(409);
      expect(test.outbox).toHaveLength(0);
    });
  });

  describe('one application per job every 6 months', () => {
    it('apply twice to the same job the same day -> 409 REAPPLY_COOLDOWN', async () => {
      const first = (await apply().expect(201)).body as { appliedAt: string };
      const second = await apply().expect(409);
      const nextAllowedAt = addMonths(new UTCDate(first.appliedAt), 6).toISOString();
      expect(second.body).toMatchObject({
        code: 'REAPPLY_COOLDOWN',
        nextAllowedAt,
        details: { lastAppliedAt: first.appliedAt, nextAllowedAt },
      });
      expect(await count()).toBe(1);
    });

    it('apply again after 5 months 29 days -> 409; after exactly 6 months -> 201', async () => {
      const appliedAt = new Date('2026-03-12T09:30:00.000Z');
      test.clock.set(appliedAt);
      expect(((await apply().expect(201)).body as { appliedAt: string }).appliedAt).toBe(
        appliedAt.toISOString(),
      );
      await setStatus('REJECTED'); // so the limit of active applications plays no part

      const sixMonths = new Date('2026-09-12T09:30:00.000Z');

      test.clock.set(addDays(addMonths(new UTCDate(appliedAt), 5), 29)); // 5 months 29 days
      const early = await apply().expect(409);
      expect(early.body).toMatchObject({
        code: 'REAPPLY_COOLDOWN',
        nextAllowedAt: sixMonths.toISOString(),
      });

      test.clock.set(new Date(sixMonths.getTime() - 1)); // one millisecond before
      await apply().expect(409);
      expect(await count()).toBe(1);

      test.clock.set(sixMonths); // exactly 6 calendar months
      const again = await apply().expect(201);
      expect((again.body as { appliedAt: string }).appliedAt).toBe(sixMonths.toISOString());
      expect(await count()).toBe(2);
    });

    it.each(['REJECTED', 'WITHDRAWN'] as const)(
      'the rule applies even if the first application was %s',
      async (status) => {
        await apply().expect(201);
        await setStatus(status);
        const response = await apply().expect(409);
        expect(response.body).toMatchObject({ code: 'REAPPLY_COOLDOWN' });
        expect(await count()).toBe(1);
      },
    );

    it('the rule applies after the candidate withdrew through the API', async () => {
      const { id } = (await apply().expect(201)).body as { id: string };
      await test
        .http()
        .post(`${API}/me/applications/${id}/withdraw`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .expect(200);
      await apply().expect(409);
    });

    it('applying to a different job is allowed', async () => {
      await apply(jobId).expect(201);
      await apply(otherJobId).expect(201);
      expect(await count()).toBe(2);
    });

    it('another candidate can apply to the same job', async () => {
      const other = await createReadyCandidate(test);
      await apply(jobId, candidate).expect(201);
      await apply(jobId, other).expect(201);
    });

    it('two parallel requests -> only one application created', async () => {
      const responses = await Promise.all([apply(), apply()]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
        code: 'REAPPLY_COOLDOWN',
      });
      expect(await count()).toBe(1);
    });

    it('eight parallel requests -> still only one application, one confirmation email', async () => {
      test.outbox.length = 0;
      const responses = await Promise.all(Array.from({ length: 8 }, () => apply()));
      expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(7);
      expect(await count()).toBe(1);
      expect(test.outbox.filter((email) => email.to === candidate.email)).toHaveLength(1);
    });

    it('counts from the latest application, not the first', async () => {
      test.clock.set(new Date('2026-01-10T10:00:00Z'));
      await apply().expect(201);
      await setStatus('REJECTED');
      test.clock.set(new Date('2026-07-10T10:00:00Z'));
      await apply().expect(201);
      await setStatus('REJECTED');
      test.clock.set(new Date('2026-12-01T10:00:00Z')); // 10 months after the first, 5 after the second
      const response = await apply().expect(409);
      expect((response.body as { nextAllowedAt: string }).nextAllowedAt).toBe(
        '2027-01-10T10:00:00.000Z',
      );
    });

    it('reads the number of months from the settings', async () => {
      test.clock.set(new Date('2026-03-12T09:30:00Z'));
      await apply().expect(201);
      await setStatus('REJECTED');
      await test.prisma.setting.create({ data: { key: 'REAPPLY_COOLDOWN_MONTHS', value: 3 } });

      test.clock.set(new Date('2026-06-12T09:29:59Z'));
      expect(((await apply().expect(409)).body as { nextAllowedAt: string }).nextAllowedAt).toBe(
        '2026-06-12T09:30:00.000Z',
      );
      test.clock.set(new Date('2026-06-12T09:30:00Z'));
      await apply().expect(201);
    });

    it('falls back to 6 months when the setting holds an invalid value', async () => {
      await test.prisma.setting.create({ data: { key: 'REAPPLY_COOLDOWN_MONTHS', value: 'soon' } });
      const first = (await apply().expect(201)).body as { appliedAt: string };
      const refused = await apply().expect(409);
      expect((refused.body as { nextAllowedAt: string }).nextAllowedAt).toBe(
        addMonths(new UTCDate(first.appliedAt), 6).toISOString(),
      );
    });
  });

  describe('preconditions', () => {
    const expectRefused = async (status: number, code: string, job = jobId) => {
      const response = await apply(job).expect(status);
      expect(response.body).toMatchObject({ code });
      expect(await count()).toBe(0);
      return response.body as { details?: Record<string, unknown> };
    };

    it('needs a verified email', async () => {
      await test.prisma.user.update({
        where: { id: candidate.id },
        data: { emailVerifiedAt: null },
      });
      await expectRefused(403, 'EMAIL_NOT_VERIFIED');
      expect((await eligibility()).reasons).toEqual(['EMAIL_NOT_VERIFIED']);
    });

    it('needs a profile complete enough, and says what is missing', async () => {
      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { dateOfBirth: null, phone: null },
      });
      const refused = await expectRefused(409, 'PROFILE_INCOMPLETE');
      expect(refused.details).toEqual({ missing: ['dateOfBirth', 'phone'] });
      expect(await eligibility()).toMatchObject({
        canApply: false,
        reasons: ['PROFILE_INCOMPLETE'],
        missing: ['dateOfBirth', 'phone'],
      });
    });

    it('needs a CV and a passport scan on file', async () => {
      await test.prisma.document.update({
        where: { id: candidate.cvId },
        data: { deletedAt: new Date() },
      });
      const refused = await expectRefused(409, 'PROFILE_INCOMPLETE');
      expect(refused.details).toEqual({ missing: ['cvDocument'] });
    });

    it('does not block for optional profile items', async () => {
      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { city: null, gender: null, currentProfession: null, educationLevel: null },
      });
      await apply().expect(201);
    });

    it('refuses an expired passport, and only warns when it expires within 6 months', async () => {
      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { passportExpiryDate: daysFromNow(-1) },
      });
      await expectRefused(409, 'PASSPORT_EXPIRED');
      expect((await eligibility()).reasons).toEqual(['PASSPORT_EXPIRED']);

      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { passportExpiryDate: daysFromNow(60) },
      });
      expect(await eligibility()).toMatchObject({ canApply: true, passportExpiringSoon: true });
      await apply().expect(201);
    });

    it.each([
      ['closed', { status: 'CLOSED' as const }],
      ['archived', { status: 'ARCHIVED' as const }],
      ['past its deadline', { deadline: daysFromNow(-1) }],
      ['full', { positions: 1, hiredCount: 1 }],
    ])('refuses a job that is %s (409 JOB_NOT_OPEN)', async (_case, seed) => {
      const job = await insertJob(test, catalog, { slug: 'unavailable', ...seed });
      await expectRefused(409, 'JOB_NOT_OPEN', job.id);
      expect((await eligibility(job.id)).reasons).toEqual(['JOB_NOT_OPEN']);
    });

    it.each([
      ['a draft', { status: 'DRAFT' as const }],
      ['a deleted job', { deletedAt: new Date() }],
    ])('answers 404 for %s, like for an unknown job', async (_case, seed) => {
      const job = await insertJob(test, catalog, { slug: 'secret', ...seed });
      await expectRefused(404, 'NOT_FOUND', job.id);
      await expectRefused(404, 'NOT_FOUND', '00000000-0000-4000-8000-000000000000');
      await test
        .http()
        .get(`${API}/jobs/${job.id}/eligibility`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .expect(404);
    });

    it('limits the number of applications in progress (default 5), finished ones do not count', async () => {
      const jobs = [];
      for (let i = 0; i < 6; i++) {
        jobs.push((await insertJob(test, catalog, { slug: `job-${i}` })).id);
      }
      for (const job of jobs.slice(0, 5)) {
        await apply(job).expect(201);
      }
      const refused = await apply(jobs[5]).expect(409);
      expect(refused.body).toMatchObject({ code: 'MAX_ACTIVE_APPLICATIONS' });
      expect((await eligibility(jobs[5])).reasons).toEqual(['MAX_ACTIVE_APPLICATIONS']);

      await setStatus('REJECTED', jobs[0]);
      await apply(jobs[5]).expect(201);
    });

    it('follows the MAX_ACTIVE_APPLICATIONS setting, also for parallel requests to different jobs', async () => {
      await test.prisma.setting.create({ data: { key: 'MAX_ACTIVE_APPLICATIONS', value: 1 } });
      const responses = await Promise.all([apply(jobId), apply(otherJobId)]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(await test.prisma.application.count()).toBe(1);
    });

    it.each([
      [
        'a document of another candidate',
        async () => [(await createReadyCandidate(test)).cvId, candidate.passportId],
      ],
      [
        'a deleted document',
        async () => {
          const extra = await test.prisma.document.create({
            data: {
              candidateId: candidate.profileId,
              type: 'CV',
              blobPath: 'x/deleted.pdf',
              originalName: 'old.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1,
              sha256: 'b'.repeat(64),
              deletedAt: new Date(),
            },
          });
          return [extra.id, candidate.passportId];
        },
      ],
      ['no CV in the selection', () => Promise.resolve([candidate.passportId])],
      ['no passport scan in the selection', () => Promise.resolve([candidate.cvId])],
      [
        'an unknown document',
        () =>
          Promise.resolve([
            candidate.cvId,
            candidate.passportId,
            '00000000-0000-4000-8000-000000000000',
          ]),
      ],
    ])('refuses %s', async (_case, ids) => {
      const response = await apply(jobId, candidate, { documentIds: await ids() }).expect(400);
      expect(response.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ path: 'documentIds' }],
      });
      expect(await count()).toBe(0);
    });

    it('refuses a failed CAPTCHA and an invalid body', async () => {
      expect(
        (await apply(jobId, candidate, { turnstileToken: BAD_CAPTCHA }).expect(400)).body,
      ).toMatchObject({ code: 'CAPTCHA_FAILED' });
      await apply(jobId, candidate, { documentIds: [] }).expect(400);
      await apply(jobId, candidate, { turnstileToken: undefined }).expect(400);
      await test
        .http()
        .post(`${API}/jobs/not-a-uuid/apply`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .send(body())
        .expect(400);
      expect(await count()).toBe(0);
    });

    it('cannot set the status, the date or the candidate through the body', async () => {
      const other = await createReadyCandidate(test);
      const response = await apply(jobId, candidate, {
        status: 'OFFER',
        appliedAt: '2020-01-01T00:00:00Z',
        candidateId: other.profileId,
      }).expect(201);
      expect(response.body).toMatchObject({ status: 'SUBMITTED' });
      const row = await test.prisma.application.findFirstOrThrow();
      expect(row.candidateId).toBe(candidate.profileId);
      expect(row.appliedAt.getFullYear()).toBeGreaterThan(2020);
    });

    it('is for candidates only, and needs a session', async () => {
      await test.http().post(`${API}/jobs/${jobId}/apply`).send(body()).expect(401);
      await test.http().get(`${API}/jobs/${jobId}/eligibility`).expect(401);
      for (const role of ['VIEWER', 'RECRUITER', 'SUPER_ADMIN'] as const) {
        const admin = await createUser(test, role);
        await test
          .http()
          .post(`${API}/jobs/${jobId}/apply`)
          .set('Cookie', cookieHeader(admin.cookies))
          .send(body())
          .expect(403);
        await test
          .http()
          .get(`${API}/jobs/${jobId}/eligibility`)
          .set('Cookie', cookieHeader(admin.cookies))
          .expect(403);
      }
      expect(await count()).toBe(0);
    });
  });

  describe('eligibility', () => {
    it('says yes to a ready candidate on an open job', async () => {
      expect(await eligibility()).toEqual({
        canApply: true,
        reasons: [],
        nextAllowedAt: null,
        lastAppliedAt: null,
        missing: [],
        passportExpiringSoon: false,
      });
    });

    it('gives the date of the last application and the next allowed date', async () => {
      const { appliedAt } = (await apply().expect(201)).body as { appliedAt: string };
      expect(await eligibility()).toMatchObject({
        canApply: false,
        reasons: ['REAPPLY_COOLDOWN'],
        lastAppliedAt: appliedAt,
        nextAllowedAt: addMonths(new UTCDate(appliedAt), 6).toISOString(),
      });
      expect((await eligibility(otherJobId)).canApply).toBe(true);
    });

    it('lists every reason at once', async () => {
      await test.prisma.user.update({
        where: { id: candidate.id },
        data: { emailVerifiedAt: null },
      });
      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { phone: null, passportExpiryDate: daysFromNow(-5) },
      });
      const closed = await insertJob(test, catalog, { slug: 'closed', status: 'CLOSED' });
      expect((await eligibility(closed.id)).reasons).toEqual([
        'EMAIL_NOT_VERIFIED',
        'PROFILE_INCOMPLETE',
        'PASSPORT_EXPIRED',
        'JOB_NOT_OPEN',
      ]);
    });

    it('agrees with what applying then does', async () => {
      expect((await eligibility()).canApply).toBe(true);
      await apply().expect(201);
      expect((await eligibility()).canApply).toBe(false);
      await apply().expect(409);
    });

    it('creates nothing', async () => {
      await eligibility();
      expect(await count()).toBe(0);
    });
  });

  describe('my applications', () => {
    const mine = async (who: ReadyCandidate = candidate) =>
      (
        (
          await test
            .http()
            .get(`${API}/me/applications`)
            .set('Cookie', cookieHeader(who.cookies))
            .expect(200)
        ).body as unknown[]
      ).map((item) => candidateApplicationSchema.parse(item));

    it('lists only my applications, newest first, with the status history', async () => {
      const other = await createReadyCandidate(test);
      await apply(jobId, other).expect(201);
      const { id } = (await apply(jobId).expect(201)).body as { id: string };
      await apply(otherJobId).expect(201);
      const recruiter = await createUser(test, 'RECRUITER');
      await test.prisma.application.update({ where: { id }, data: { status: 'UNDER_REVIEW' } });
      await test.prisma.applicationStatusHistory.create({
        data: {
          applicationId: id,
          fromStatus: 'SUBMITTED',
          toStatus: 'UNDER_REVIEW',
          changedById: recruiter.id,
          comment: 'INTERNAL: weak English',
        },
      });
      await test.prisma.applicationNote.create({
        data: {
          applicationId: id,
          authorId: recruiter.id,
          body: 'INTERNAL NOTE: call the agent first',
        },
      });

      const list = await mine();
      expect(list.map((application) => application.job.slug)).toEqual(['cook', 'receptionist']);
      const reviewed = list.find((application) => application.id === id);
      expect(reviewed?.status).toBe('UNDER_REVIEW');
      expect(reviewed?.history.map((entry) => [entry.fromStatus, entry.toStatus])).toEqual([
        [null, 'SUBMITTED'],
        ['SUBMITTED', 'UNDER_REVIEW'],
      ]);
    });

    it('never shows internal notes, recruiter comments or who changed a status', async () => {
      const { id } = (await apply().expect(201)).body as { id: string };
      const recruiter = await createUser(test, 'RECRUITER');
      await test.prisma.applicationStatusHistory.create({
        data: {
          applicationId: id,
          fromStatus: 'SUBMITTED',
          toStatus: 'UNDER_REVIEW',
          changedById: recruiter.id,
          comment: 'INTERNAL: weak English',
        },
      });
      await test.prisma.applicationNote.create({
        data: {
          applicationId: id,
          authorId: recruiter.id,
          body: 'INTERNAL NOTE: call the agent first',
        },
      });
      const raw = JSON.stringify(
        (
          await test
            .http()
            .get(`${API}/me/applications`)
            .set('Cookie', cookieHeader(candidate.cookies))
            .expect(200)
        ).body,
      );
      expect(raw).not.toContain('INTERNAL');
      expect(raw).not.toContain(recruiter.id);
      expect(raw).not.toContain(recruiter.email);
      expect(raw).not.toMatch(/"notes"|"comment"|"changedBy/);
    });
  });

  describe('withdrawing', () => {
    const withdraw = (id: string, who: ReadyCandidate = candidate) =>
      test
        .http()
        .post(`${API}/me/applications/${id}/withdraw`)
        .set('Cookie', cookieHeader(who.cookies));

    it('withdraws an application and records it in the history', async () => {
      const { id } = (await apply().expect(201)).body as { id: string };
      const response = await withdraw(id).expect(200);
      const application = candidateApplicationSchema.parse(response.body);
      expect(application).toMatchObject({ status: 'WITHDRAWN', canWithdraw: false });
      expect(application.withdrawnAt).not.toBeNull();
      expect(application.history.at(-1)).toMatchObject({
        fromStatus: 'SUBMITTED',
        toStatus: 'WITHDRAWN',
      });
      const history = await test.prisma.applicationStatusHistory.findMany({
        where: { applicationId: id, toStatus: 'WITHDRAWN' },
      });
      expect(history[0]?.changedById).toBe(candidate.id);
    });

    it.each(['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'OFFER'] as const)(
      'is allowed at %s',
      async (status) => {
        const { id } = (await apply().expect(201)).body as { id: string };
        await test.prisma.application.update({ where: { id }, data: { status } });
        await withdraw(id).expect(200);
      },
    );

    it.each([
      'CONTRACT_SIGNED',
      'VISA_PROCESSING',
      'VISA_APPROVED',
      'DEPLOYED',
      'REJECTED',
      'WITHDRAWN',
    ] as const)('is refused at %s (409 CANNOT_WITHDRAW)', async (status) => {
      const { id } = (await apply().expect(201)).body as { id: string };
      await test.prisma.application.update({ where: { id }, data: { status } });
      const response = await withdraw(id).expect(409);
      expect(response.body).toMatchObject({ code: 'CANNOT_WITHDRAW', details: { status } });
      expect((await test.prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe(
        status,
      );
    });

    it("cannot withdraw another candidate's application", async () => {
      const other = await createReadyCandidate(test);
      const { id } = (await apply().expect(201)).body as { id: string };
      await withdraw(id, other).expect(404);
      expect((await test.prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe(
        'SUBMITTED',
      );
    });

    it('frees a slot of active applications', async () => {
      await test.prisma.setting.create({ data: { key: 'MAX_ACTIVE_APPLICATIONS', value: 1 } });
      const { id } = (await apply(jobId).expect(201)).body as { id: string };
      await apply(otherJobId).expect(409);
      await withdraw(id).expect(200);
      await apply(otherJobId).expect(201);
    });
  });
});
