import {
  adminApplicationDetailSchema,
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from '@iconbridge/shared';
import ExcelJS from 'exceljs';
import {
  createReadyCandidate,
  createTestApp,
  createUser,
  daysFromNow,
  insertJob,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type TestApp,
  type TestUser,
} from './app.js';
import { TasksService } from '../../src/tasks/tasks.service.js';
import { advanceTo, applyTo, as, newApplication, PIPELINE_AFTER_SUBMITTED } from './back-office.js';

describe('admin applications (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let viewer: TestUser;
  let recruiter: TestUser;
  let superAdmin: TestUser;
  let jobId: string;

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
    catalog = await seedCatalog(test);
    viewer = await createUser(test, 'VIEWER');
    recruiter = await createUser(test, 'RECRUITER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');
    jobId = (
      await insertJob(test, catalog, {
        slug: 'welder',
        title: 'Welder',
        destination: 'POLAND',
        positions: 2,
      })
    ).id;
    test.outbox.length = 0;
  });

  const setStatus = (
    id: string,
    status: ApplicationStatus,
    user: TestUser = recruiter,
    extra: object = {},
  ) => as(test, user).patch(`/admin/applications/${id}/status`, { status, ...extra });
  const statusOf = async (id: string) =>
    (await test.prisma.application.findUniqueOrThrow({ where: { id } })).status;
  const hiredCount = async () =>
    (await test.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).hiredCount;

  describe('state machine', () => {
    it('moves an application through the whole pipeline, one email to the candidate per step', async () => {
      const { candidate, id } = await newApplication(test, jobId);
      await test.prisma.user.update({ where: { id: candidate.id }, data: { locale: 'fr' } });
      test.outbox.length = 0;

      for (const status of PIPELINE_AFTER_SUBMITTED) {
        const response = await setStatus(id, status, recruiter, {
          comment: `internal ${status}`,
          messageToCandidate: `message ${status}`,
        }).expect(200);
        expect(adminApplicationDetailSchema.parse(response.body).status).toBe(status);
      }

      const toCandidate = test.outbox.filter((email) => email.to === candidate.email);
      expect(toCandidate).toHaveLength(8);
      expect(toCandidate.map((email) => email.subject)).toEqual([
        "Votre candidature : En cours d'examen - IconBridge Jobs",
        'Votre candidature : Présélectionnée - IconBridge Jobs',
        'Votre candidature : Entretien - IconBridge Jobs',
        'Votre candidature : Offre - IconBridge Jobs',
        'Votre candidature : Contrat signé - IconBridge Jobs',
        'Votre candidature : Visa en cours - IconBridge Jobs',
        'Votre candidature : Visa approuvé - IconBridge Jobs',
        'Votre candidature : En poste - IconBridge Jobs',
      ]);
      for (const [index, email] of toCandidate.entries()) {
        const status = PIPELINE_AFTER_SUBMITTED[index] ?? '';
        expect(email.text).toContain('Welder');
        expect(email.text).toContain(`message ${status}`);
        expect(email.text + email.html).not.toContain('internal');
      }
      expect(test.outbox).toHaveLength(8); // nobody else is emailed
    });

    it('cannot jump from Submitted to Visa approved, nor skip any step', async () => {
      const { id } = await newApplication(test, jobId);
      test.outbox.length = 0;
      const jump = await setStatus(id, 'VISA_APPROVED', superAdmin).expect(409);
      expect(jump.body).toMatchObject({
        code: 'INVALID_APPLICATION_TRANSITION',
        details: { from: 'SUBMITTED', to: 'VISA_APPROVED', allowed: ['UNDER_REVIEW', 'REJECTED'] },
      });
      for (const status of [
        'SHORTLISTED',
        'INTERVIEW',
        'OFFER',
        'CONTRACT_SIGNED',
        'VISA_PROCESSING',
        'DEPLOYED',
      ] as const) {
        await setStatus(id, status).expect(409);
      }
      expect(await statusOf(id)).toBe('SUBMITTED');
      expect(
        await test.prisma.applicationStatusHistory.count({ where: { applicationId: id } }),
      ).toBe(1);
      expect(test.outbox).toHaveLength(0);
    });

    it('cannot go backwards, stay in place, or be set to Submitted or Withdrawn by the back office', async () => {
      const { id } = await newApplication(test, jobId);
      await advanceTo(test, recruiter, id, 'INTERVIEW');
      for (const status of ['SHORTLISTED', 'INTERVIEW', 'SUBMITTED', 'WITHDRAWN'] as const) {
        await setStatus(id, status, superAdmin).expect(409);
      }
      await setStatus(id, 'HIRED' as ApplicationStatus).expect(400);
      expect(await statusOf(id)).toBe('INTERVIEW');
    });

    it('can reject from any step that is not final', async () => {
      for (const from of ['SUBMITTED', 'UNDER_REVIEW', 'OFFER', 'VISA_APPROVED'] as const) {
        const { id } = await newApplication(test, jobId);
        if (from !== 'SUBMITTED') {
          await advanceTo(test, recruiter, id, from);
        }
        await setStatus(id, 'REJECTED').expect(200);
        expect(await statusOf(id)).toBe('REJECTED');
      }
    });

    it.each(['REJECTED', 'WITHDRAWN'] as const)(
      '%s is final for a recruiter; a super admin can reopen it to Under review',
      async (final) => {
        const { candidate, id } = await newApplication(test, jobId);
        if (final === 'REJECTED') {
          await setStatus(id, 'REJECTED').expect(200);
        } else {
          await as(test, candidate).post(`/me/applications/${id}/withdraw`).expect(200);
        }
        for (const status of APPLICATION_STATUSES) {
          await setStatus(id, status, recruiter).expect(409);
        }
        await setStatus(id, 'SHORTLISTED', superAdmin).expect(409);
        const reopened = await setStatus(id, 'UNDER_REVIEW', superAdmin, {
          comment: 'Reopened after appeal',
        }).expect(200);
        expect(reopened.body).toMatchObject({ status: 'UNDER_REVIEW', withdrawnAt: null });
        // The pipeline continues normally afterwards.
        await setStatus(id, 'SHORTLISTED', recruiter).expect(200);
      },
    );

    it('Deployed is final for everybody', async () => {
      const { id } = await newApplication(test, jobId);
      await advanceTo(test, recruiter, id, 'DEPLOYED');
      for (const status of APPLICATION_STATUSES) {
        await setStatus(id, status, superAdmin).expect(409);
      }
    });

    it('tells the client which moves are allowed for the current user', async () => {
      const { id } = await newApplication(test, jobId);
      const allowed = async (user: TestUser) =>
        (
          (await as(test, user).get(`/admin/applications/${id}`).expect(200)).body as {
            allowedTransitions: string[];
          }
        ).allowedTransitions;
      expect(await allowed(recruiter)).toEqual(['UNDER_REVIEW', 'REJECTED']);
      expect(await allowed(viewer)).toEqual([]);
      await setStatus(id, 'REJECTED').expect(200);
      expect(await allowed(recruiter)).toEqual([]);
      expect(await allowed(superAdmin)).toEqual(['UNDER_REVIEW']);
    });

    it('two recruiters moving the same application at once: one wins, the history has one new row', async () => {
      const { id } = await newApplication(test, jobId);
      const other = await createUser(test, 'RECRUITER');
      const responses = await Promise.all([
        setStatus(id, 'UNDER_REVIEW', recruiter),
        setStatus(id, 'UNDER_REVIEW', other),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(
        await test.prisma.applicationStatusHistory.count({ where: { applicationId: id } }),
      ).toBe(2);
    });
  });

  describe('history, comments and audit', () => {
    it('stores who, when, from, to, the internal comment and the message; the candidate sees only the message', async () => {
      const { candidate, id } = await newApplication(test, jobId);
      await setStatus(id, 'UNDER_REVIEW', recruiter, {
        comment: 'SECRET: weak CV',
        messageToCandidate: 'We are reading your file',
      }).expect(200);

      const detail = adminApplicationDetailSchema.parse(
        (await as(test, viewer).get(`/admin/applications/${id}`).expect(200)).body,
      );
      expect(detail.history.at(-1)).toMatchObject({
        fromStatus: 'SUBMITTED',
        toStatus: 'UNDER_REVIEW',
        changedByEmail: recruiter.email,
        comment: 'SECRET: weak CV',
        messageToCandidate: 'We are reading your file',
      });

      const mine = JSON.stringify(
        (await as(test, candidate).get('/me/applications').expect(200)).body,
      );
      expect(mine).toContain('We are reading your file');
      expect(mine).not.toContain('SECRET');
      expect(mine).not.toContain(recruiter.email);
      const email = test.outbox.find(
        (message) => message.to === candidate.email && message.subject.includes('Under review'),
      );
      expect(email?.text).toContain('We are reading your file');
      expect(`${email?.text ?? ''}${email?.html ?? ''}`).not.toContain('SECRET');
    });

    it('writes one audit entry per change, with the actor and both statuses, without the texts', async () => {
      const { id } = await newApplication(test, jobId);
      await setStatus(id, 'UNDER_REVIEW', recruiter, {
        comment: 'SECRET',
        messageToCandidate: 'Hello',
      }).expect(200);
      await setStatus(id, 'VISA_APPROVED').expect(409);
      const entries = await test.prisma.auditLog.findMany({
        where: { action: 'application.change_status' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: recruiter.id,
        entityType: 'application',
        entityId: id,
        before: { status: 'SUBMITTED' },
        after: { status: 'UNDER_REVIEW', hasMessageToCandidate: true },
      });
      expect(JSON.stringify(entries)).not.toContain('SECRET');
    });

    it('emails the candidate in their own language', async () => {
      const arabic = await newApplication(test, jobId);
      await test.prisma.user.update({ where: { id: arabic.candidate.id }, data: { locale: 'ar' } });
      await setStatus(arabic.id, 'UNDER_REVIEW').expect(200);
      const email = test.outbox.find(
        (message) =>
          message.to === arabic.candidate.email && message.subject.includes('قيد المراجعة'),
      );
      expect(email?.html).toContain('dir="rtl"');
    });
  });

  describe('hired count', () => {
    it('increments when an application becomes Deployed, and only then', async () => {
      const { id } = await newApplication(test, jobId);
      for (const status of PIPELINE_AFTER_SUBMITTED) {
        expect(await hiredCount()).toBe(0);
        await setStatus(id, status).expect(200);
      }
      expect(await hiredCount()).toBe(1);
    });

    it('does not count rejected or withdrawn applications', async () => {
      const rejected = await newApplication(test, jobId);
      await advanceTo(test, recruiter, rejected.id, 'VISA_APPROVED');
      await setStatus(rejected.id, 'REJECTED').expect(200);
      expect(await hiredCount()).toBe(0);
    });

    it('fills the job: the last position closes it to candidates, and one more hire is refused', async () => {
      const [first, second, third] = [
        await newApplication(test, jobId),
        await newApplication(test, jobId),
        await newApplication(test, jobId),
      ];
      for (const application of [first, second, third]) {
        await advanceTo(test, recruiter, application.id, 'VISA_APPROVED');
      }
      await setStatus(first.id, 'DEPLOYED').expect(200);
      await test.http().get('/api/v1/jobs/welder').expect(200);
      await setStatus(second.id, 'DEPLOYED').expect(200);
      expect(await hiredCount()).toBe(2);
      // 2 positions, 2 hired: the job is no longer public.
      await test.http().get('/api/v1/jobs/welder').expect(404);

      const refused = await setStatus(third.id, 'DEPLOYED').expect(409);
      expect(refused.body).toMatchObject({ code: 'NO_POSITION_LEFT' });
      expect(await statusOf(third.id)).toBe('VISA_APPROVED');
      expect(await hiredCount()).toBe(2);
    });

    it('two deployments at once for the last position: only one succeeds', async () => {
      await test.prisma.job.update({ where: { id: jobId }, data: { positions: 1 } });
      const [first, second] = [
        await newApplication(test, jobId),
        await newApplication(test, jobId),
      ];
      await advanceTo(test, recruiter, first.id, 'VISA_APPROVED');
      await advanceTo(test, recruiter, second.id, 'VISA_APPROVED');
      const responses = await Promise.all([
        setStatus(first.id, 'DEPLOYED'),
        setStatus(second.id, 'DEPLOYED'),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(await hiredCount()).toBe(1);
      expect(await test.prisma.application.count({ where: { status: 'DEPLOYED' } })).toBe(1);
    });

    it('lets the scheduled task close the full job', async () => {
      await test.prisma.job.update({ where: { id: jobId }, data: { positions: 1 } });
      const { id } = await newApplication(test, jobId);
      await advanceTo(test, recruiter, id, 'DEPLOYED');
      const report = await test.app.get(TasksService).run('close-jobs');
      expect(report).toMatchObject({ ok: true, ran: true });
      expect((await test.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
        'CLOSED',
      );
    });
  });

  describe('bulk status change', () => {
    it('changes each application on its own and reports the ones that could not change', async () => {
      const a = await newApplication(test, jobId);
      const b = await newApplication(test, jobId);
      const c = await newApplication(test, jobId);
      await setStatus(c.id, 'REJECTED').expect(200);
      test.outbox.length = 0;
      const unknown = '00000000-0000-4000-8000-000000000000';

      const response = await as(test, recruiter)
        .post('/admin/applications/bulk-status', {
          ids: [a.id, b.id, c.id, unknown],
          status: 'UNDER_REVIEW',
          messageToCandidate: 'Good news',
        })
        .expect(200);
      expect(response.body).toMatchObject({ changed: 2, failed: 2 });
      const results = (response.body as { results: { id: string; ok: boolean; code?: string }[] })
        .results;
      expect(results).toEqual([
        { id: a.id, ok: true },
        { id: b.id, ok: true },
        expect.objectContaining({ id: c.id, ok: false, code: 'INVALID_APPLICATION_TRANSITION' }),
        expect.objectContaining({ id: unknown, ok: false, code: 'NOT_FOUND' }),
      ]);
      expect(await statusOf(a.id)).toBe('UNDER_REVIEW');
      expect(await statusOf(c.id)).toBe('REJECTED');
      // One email and one audit entry per application changed.
      expect(test.outbox.map((email) => email.to).sort()).toEqual(
        [a.candidate.email, b.candidate.email].sort(),
      );
      expect(
        await test.prisma.auditLog.count({ where: { action: 'application.change_status' } }),
      ).toBe(3);
    });

    it('validates the body', async () => {
      await as(test, recruiter)
        .post('/admin/applications/bulk-status', { ids: [], status: 'UNDER_REVIEW' })
        .expect(400);
      await as(test, recruiter)
        .post('/admin/applications/bulk-status', { ids: ['x'], status: 'UNDER_REVIEW' })
        .expect(400);
    });
  });

  describe('internal notes', () => {
    it('adds, edits and deletes notes; they appear in the admin detail only', async () => {
      const { candidate, id } = await newApplication(test, jobId);
      const created = await as(test, recruiter)
        .post(`/admin/applications/${id}/notes`, { body: 'NOTE: call the agent' })
        .expect(201);
      const noteId = (created.body as { id: string }).id;
      await as(test, recruiter)
        .patch(`/admin/applications/${id}/notes/${noteId}`, { body: 'NOTE: agent called' })
        .expect(200);

      const detail = adminApplicationDetailSchema.parse(
        (await as(test, viewer).get(`/admin/applications/${id}`).expect(200)).body,
      );
      expect(detail.notes).toEqual([
        expect.objectContaining({ body: 'NOTE: agent called', authorEmail: recruiter.email }),
      ]);

      for (const path of ['/me/applications', '/me/profile', '/me/documents']) {
        expect(
          JSON.stringify((await as(test, candidate).get(path).expect(200)).body),
        ).not.toContain('NOTE');
      }
      const exported = await as(test, candidate)
        .get('/me/export')
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
        });
      expect((exported.body as Buffer).includes('NOTE')).toBe(false);

      await as(test, recruiter).delete(`/admin/applications/${id}/notes/${noteId}`).expect(204);
      expect(await test.prisma.applicationNote.count()).toBe(0);
    });

    it('lets only the author or a super admin change a note; a viewer cannot write one', async () => {
      const { id } = await newApplication(test, jobId);
      const noteId = (
        (
          await as(test, recruiter)
            .post(`/admin/applications/${id}/notes`, { body: 'mine' })
            .expect(201)
        ).body as { id: string }
      ).id;
      const other = await createUser(test, 'RECRUITER');
      await as(test, other)
        .patch(`/admin/applications/${id}/notes/${noteId}`, { body: 'changed' })
        .expect(403);
      await as(test, other).delete(`/admin/applications/${id}/notes/${noteId}`).expect(403);
      await as(test, viewer).post(`/admin/applications/${id}/notes`, { body: 'x' }).expect(403);
      await as(test, superAdmin)
        .patch(`/admin/applications/${id}/notes/${noteId}`, { body: 'moderated' })
        .expect(200);
      await as(test, recruiter).post(`/admin/applications/${id}/notes`, { body: '' }).expect(400);
      await as(test, recruiter)
        .patch(`/admin/applications/00000000-0000-4000-8000-000000000000/notes/${noteId}`, {
          body: 'x',
        })
        .expect(404);
    });
  });

  describe('list and detail', () => {
    it('filters by job, destination, status, dates, nationality, language and text; sorts and paginates', async () => {
      const maltaJob = (
        await insertJob(test, catalog, { slug: 'cook', title: 'Cook', destination: 'MALTA' })
      ).id;
      const amira = await createReadyCandidate(test, 'amira.zed@example.test');
      const omar = await createReadyCandidate(test, 'omar@example.test');
      await test.prisma.candidateProfile.update({
        where: { id: amira.profileId },
        data: {
          firstName: 'Amira',
          lastName: 'Zed',
          nationality: 'MA',
          languages: { create: { language: 'fr', level: 'C1' } },
        },
      });
      await test.prisma.candidateProfile.update({
        where: { id: omar.profileId },
        data: { firstName: 'Omar', lastName: 'Alpha' },
      });
      test.clock.set(daysFromNow(-10));
      const a1 = await applyTo(test, amira, jobId);
      test.clock.set(daysFromNow(-3));
      const o1 = await applyTo(test, omar, jobId);
      test.clock.reset();
      const a2 = await applyTo(test, amira, maltaJob);
      await setStatus(o1, 'UNDER_REVIEW').expect(200);

      const ids = async (query: string) =>
        (
          (await as(test, viewer).get(`/admin/applications${query}`).expect(200)).body as {
            items: { id: string }[];
          }
        ).items.map((item) => item.id);
      const day = (offset: number) => daysFromNow(offset).toISOString().slice(0, 10);

      expect(await ids('')).toEqual([a2, o1, a1]);
      expect(await ids('?sort=oldest')).toEqual([a1, o1, a2]);
      expect(await ids('?sort=name')).toEqual([o1, ...[a1, a2].sort()]);
      expect(await ids(`?jobId=${maltaJob}`)).toEqual([a2]);
      expect(await ids('?destination=poland')).toEqual([o1, a1]);
      expect(await ids('?status=UNDER_REVIEW')).toEqual([o1]);
      expect(await ids(`?appliedFrom=${day(-5)}`)).toEqual([a2, o1]);
      expect(await ids(`?appliedTo=${day(-5)}`)).toEqual([a1]);
      expect(await ids(`?appliedFrom=${day(-5)}&appliedTo=${day(-1)}`)).toEqual([o1]);
      expect(await ids('?nationality=MA')).toEqual([a2, a1]);
      expect(await ids('?language=fr')).toEqual([a2, a1]);
      expect(await ids('?q=zed')).toEqual([a2, a1]);
      expect(await ids('?q=OMAR@example')).toEqual([o1]);
      expect(await ids('?q=nobody')).toEqual([]);
      expect(await ids('?pageSize=2&page=2')).toEqual([a1]);
      await as(test, viewer).get('/admin/applications?status=OPEN').expect(400);
      await as(test, viewer).get('/admin/applications?nationality=XX').expect(400);
    });

    it('shows the snapshot, the documents and no clear passport number', async () => {
      const { id } = await newApplication(test, jobId);
      const response = await as(test, viewer).get(`/admin/applications/${id}`).expect(200);
      const detail = adminApplicationDetailSchema.parse(response.body);
      expect(detail.profileSnapshot).toMatchObject({
        passportNumberMasked: '********567',
        nationality: 'TN',
      });
      expect(detail.documents.map((document) => document.type).sort()).toEqual(['CV', 'PASSPORT']);
      expect(JSON.stringify(response.body)).not.toContain('FAKE1234567');
      await as(test, viewer)
        .get('/admin/applications/00000000-0000-4000-8000-000000000000')
        .expect(404);
    });
  });

  describe('export', () => {
    const exportAs = (user: TestUser, body: object) =>
      as(test, user)
        .post('/admin/applications/export', body)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
        });
    const text = (body: unknown) => (body as Buffer).toString('utf8');

    it('is refused to a viewer and to a candidate', async () => {
      const { candidate } = await newApplication(test, jobId);
      await as(test, viewer).post('/admin/applications/export', { format: 'csv' }).expect(403);
      await as(test, candidate).post('/admin/applications/export', { format: 'csv' }).expect(403);
      await test
        .http()
        .post('/api/v1/admin/applications/export')
        .send({ format: 'csv' })
        .expect(401);
      expect(
        await test.prisma.auditLog.count({
          where: { action: { startsWith: 'application.export' } },
        }),
      ).toBe(0);
    });

    it('gives a recruiter a CSV with the masked passport number only', async () => {
      const { candidate } = await newApplication(test, jobId);
      const response = await exportAs(recruiter, { format: 'csv' }).expect(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toMatch(
        /attachment; filename="applications-\d{4}-\d{2}-\d{2}\.csv"/,
      );
      const csv = text(response.body);
      const [header, row] = csv.slice(1).trim().split('\r\n');
      expect(header).toBe(
        'Application ID,Status,Applied at,Job,Destination,First name,Last name,Email,Phone,Nationality,Country of residence,Date of birth,Passport (masked),Passport expiry,Profession,Years of experience,Languages',
      );
      expect(row).toContain(candidate.email);
      expect(row).toContain('********567');
      expect(row).toContain('Welder,POLAND');
      expect(csv).not.toContain('FAKE1234567');
      expect(csv).not.toContain('Passport number');
    });

    it('refuses the full passport number to a recruiter, whatever the flag', async () => {
      await newApplication(test, jobId);
      const refused = await as(test, recruiter)
        .post('/admin/applications/export', {
          format: 'csv',
          columns: ['email', 'passportNumber'],
          includeFullPassportNumber: true,
        })
        .expect(403);
      expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(JSON.stringify(refused.body)).not.toContain('FAKE1234567');
      expect(
        await test.prisma.auditLog.count({
          where: { action: { startsWith: 'application.export' } },
        }),
      ).toBe(0);
    });

    it('needs the super admin to tick the option explicitly: the column alone, or the flag alone, is rejected', async () => {
      await newApplication(test, jobId);
      await as(test, superAdmin)
        .post('/admin/applications/export', { format: 'csv', columns: ['email', 'passportNumber'] })
        .expect(400);
      await as(test, superAdmin)
        .post('/admin/applications/export', {
          format: 'csv',
          columns: ['email'],
          includeFullPassportNumber: true,
        })
        .expect(400);
      const byDefault = text((await exportAs(superAdmin, { format: 'csv' }).expect(200)).body);
      expect(byDefault).not.toContain('FAKE1234567');
    });

    it('gives the super admin the full number when asked, and logs it', async () => {
      const { id } = await newApplication(test, jobId);
      const response = await exportAs(superAdmin, {
        format: 'csv',
        columns: ['applicationId', 'lastName', 'passportNumber'],
        includeFullPassportNumber: true,
      }).expect(200);
      expect(text(response.body).slice(1)).toBe(
        `Application ID,Last name,Passport number\r\n${id},Candidate,FAKE1234567\r\n`,
      );

      const entries = await test.prisma.auditLog.findMany({
        where: { action: 'application.export_with_passport_numbers' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: superAdmin.id,
        after: {
          rows: 1,
          includeFullPassportNumber: true,
          columns: ['applicationId', 'lastName', 'passportNumber'],
          format: 'csv',
        },
      });
      expect(entries[0]?.ip).toBeTruthy();
      // The log says that numbers were exported, not which ones.
      expect(JSON.stringify(entries)).not.toContain('FAKE1234567');
    });

    it('logs every ordinary export too', async () => {
      await newApplication(test, jobId);
      await exportAs(recruiter, { format: 'csv', columns: ['email', 'status'] }).expect(200);
      const entry = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'application.export' },
      });
      expect(entry).toMatchObject({
        actorId: recruiter.id,
        after: { rows: 1, includeFullPassportNumber: false, columns: ['email', 'status'] },
      });
    });

    it('exports a selection by ids, or everything matching filters', async () => {
      const a = await newApplication(test, jobId);
      const b = await newApplication(test, jobId);
      await setStatus(b.id, 'UNDER_REVIEW').expect(200);
      const lines = async (body: object) =>
        text(
          (
            await exportAs(recruiter, {
              format: 'csv',
              columns: ['applicationId'],
              ...body,
            }).expect(200)
          ).body,
        )
          .trim()
          .split('\r\n')
          .slice(1);
      expect(await lines({ ids: [a.id] })).toEqual([a.id]);
      expect(await lines({ filters: { status: 'UNDER_REVIEW' } })).toEqual([b.id]);
      expect((await lines({})).sort()).toEqual([a.id, b.id].sort());
    });

    it('produces a readable Excel file, with formulas from candidate data neutralised', async () => {
      const { candidate } = await newApplication(test, jobId);
      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { firstName: '=HYPERLINK("http://evil","x")' },
      });
      const response = await exportAs(recruiter, {
        format: 'xlsx',
        columns: ['firstName', 'email', 'passportNumberMasked'],
      }).expect(200);
      expect(response.headers['content-type']).toContain('spreadsheetml');
      const workbook = new ExcelJS.Workbook();
      const data = response.body as Buffer;
      await workbook.xlsx.load(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      );
      const sheet = workbook.getWorksheet('Applications');
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        'First name',
        'Email',
        'Passport (masked)',
      ]);
      const row = sheet?.getRow(2);
      expect(row?.getCell(1).value).toBe('\'=HYPERLINK("http://evil","x")');
      expect(row?.getCell(1).formula).toBeUndefined();
      expect(row?.getCell(2).value).toBe(candidate.email);
      const csv = text(
        (await exportAs(recruiter, { format: 'csv', columns: ['firstName'] }).expect(200)).body,
      );
      expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    });

    it('rejects unknown columns and formats', async () => {
      await as(test, recruiter).post('/admin/applications/export', { format: 'pdf' }).expect(400);
      await as(test, recruiter)
        .post('/admin/applications/export', { format: 'csv', columns: ['passwordHash'] })
        .expect(400);
    });
  });
});
