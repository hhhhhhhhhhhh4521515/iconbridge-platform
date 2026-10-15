import {
  API,
  cookieHeader,
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
import { as, newApplication } from './back-office.js';
import { MailService } from '../../src/mail/mail.service.js';

const MINUTE = 60_000;

interface Detail {
  status: string;
  undo: { toStatus: string; until: string } | null;
  history: { toStatus: string; revertedAt: string | null }[];
  questions: { id: string }[];
  answers: Record<string, string> | null;
}

describe('back-office adjustments (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let viewer: TestUser;
  let recruiter: TestUser;
  let otherRecruiter: TestUser;
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
    test.mailServer.down = false;
    catalog = await seedCatalog(test);
    viewer = await createUser(test, 'VIEWER');
    recruiter = await createUser(test, 'RECRUITER');
    otherRecruiter = await createUser(test, 'RECRUITER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');
    test.outbox.length = 0;
  });

  describe('passport number: masked by default, revealed by an audited action', () => {
    it('never gives the clear number to a viewer', async () => {
      const job = await insertJob(test, catalog, { slug: 'job' });
      const { candidate } = await newApplication(test, job.id);
      const refused = await as(test, viewer)
        .post(`/admin/candidates/${candidate.profileId}/reveal-passport`)
        .expect(403);
      expect(JSON.stringify(refused.body)).not.toContain('FAKE1234567');
      expect(
        await test.prisma.auditLog.count({ where: { action: 'candidate.reveal_passport' } }),
      ).toBe(0);
    });

    it.each(['RECRUITER', 'SUPER_ADMIN'] as const)(
      'reveals it to a %s and writes the audit entry without the number',
      async (role) => {
        const job = await insertJob(test, catalog, { slug: 'job' });
        const { candidate } = await newApplication(test, job.id);
        const user = role === 'RECRUITER' ? recruiter : superAdmin;
        const response = await as(test, user)
          .post(`/admin/candidates/${candidate.profileId}/reveal-passport`)
          .expect(200);
        expect(response.body).toEqual({ passportNumber: 'FAKE1234567' });
        const entry = await test.prisma.auditLog.findFirstOrThrow({
          where: { action: 'candidate.reveal_passport' },
        });
        expect(entry).toMatchObject({
          actorId: user.id,
          entityType: 'candidate',
          entityId: candidate.profileId,
        });
        expect(JSON.stringify(entry)).not.toContain('FAKE1234567');
      },
    );

    it('answers 404 for an unknown candidate and 401 to a visitor', async () => {
      await as(test, recruiter)
        .post('/admin/candidates/00000000-0000-4000-8000-000000000000/reveal-passport')
        .expect(404);
      await test
        .http()
        .post(`${API}/admin/candidates/00000000-0000-4000-8000-000000000000/reveal-passport`)
        .expect(401);
    });
  });

  describe('undo of the last status change', () => {
    const start = new Date('2026-03-02T10:00:00.000Z');
    let id: string;
    let candidate: TestUser;
    let jobId: string;

    beforeEach(async () => {
      test.clock.set(start);
      jobId = (await insertJob(test, catalog, { slug: 'job', title: 'Welder', positions: 1 })).id;
      ({ id, candidate } = await newApplication(test, jobId));
      await as(test, recruiter)
        .patch(`/admin/applications/${id}/status`, { status: 'UNDER_REVIEW' })
        .expect(200);
      test.outbox.length = 0;
    });

    const detail = async (user: TestUser) =>
      (await as(test, user).get(`/admin/applications/${id}`).expect(200)).body as Detail;
    const undo = (user: TestUser) => as(test, user).post(`/admin/applications/${id}/undo-status`);

    it('puts the application back, keeps the undone row marked, audits and sends a correction', async () => {
      expect((await detail(recruiter)).undo).toEqual({
        toStatus: 'SUBMITTED',
        until: new Date(start.getTime() + 15 * MINUTE).toISOString(),
      });
      test.clock.set(new Date(start.getTime() + 5 * MINUTE));
      const response = await undo(recruiter).expect(200);
      const body = response.body as Detail;
      expect(body.status).toBe('SUBMITTED');
      expect(body.undo).toBeNull();
      expect(body.history.map((entry) => [entry.toStatus, entry.revertedAt !== null])).toEqual([
        ['SUBMITTED', false],
        ['UNDER_REVIEW', true],
      ]);

      const audit = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'application.undo_status' },
      });
      expect(audit).toMatchObject({
        actorId: recruiter.id,
        entityId: id,
        before: { status: 'UNDER_REVIEW' },
        after: { status: 'SUBMITTED', candidateWasNotified: true },
      });

      // The first email had gone out: the candidate gets a short correction, in their language.
      expect(test.outbox).toHaveLength(1);
      expect(test.outbox[0]?.to).toBe(candidate.email);
      expect(test.outbox[0]?.subject).toContain('Correction');
      expect(test.outbox[0]?.text).toContain('Welder');
      expect(test.outbox[0]?.text).toContain('Submitted');
    });

    it('hides the undone step from the candidate', async () => {
      await undo(recruiter).expect(200);
      const mine = (await as(test, candidate).get('/me/applications').expect(200)).body as {
        status: string;
        history: { toStatus: string }[];
      }[];
      expect(mine[0]?.status).toBe('SUBMITTED');
      expect(mine[0]?.history.map((entry) => entry.toStatus)).toEqual(['SUBMITTED']);
    });

    it('withdraws the first email instead of correcting it when it had not left yet', async () => {
      // The mail server was down when the status changed: the email waits in the outbox.
      await undo(recruiter).expect(200);
      test.outbox.length = 0;
      test.mailServer.down = true;
      await as(test, recruiter)
        .patch(`/admin/applications/${id}/status`, { status: 'UNDER_REVIEW' })
        .expect(200);
      test.mailServer.down = false;
      expect(await test.prisma.emailOutbox.count({ where: { status: 'PENDING' } })).toBe(1);

      await undo(recruiter).expect(200);
      // Nothing is sent, now or at the next run: the candidate never hears of the mistake.
      await test.app.get(MailService).sendDue();
      expect(test.outbox).toHaveLength(0);
      expect(await test.prisma.emailOutbox.count({ where: { status: 'CANCELLED' } })).toBe(1);
      const audit = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'application.undo_status' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.after).toMatchObject({
        candidateWasNotified: false,
        pendingEmailWithdrawn: true,
      });
    });

    it('is allowed at exactly 15 minutes and refused one second later', async () => {
      test.clock.set(new Date(start.getTime() + 15 * MINUTE + 1000));
      expect((await detail(recruiter)).undo).toBeNull();
      const late = await undo(recruiter).expect(409);
      expect((late.body as { code: string }).code).toBe('UNDO_NOT_ALLOWED');
      expect((await detail(recruiter)).status).toBe('UNDER_REVIEW');

      test.clock.set(new Date(start.getTime() + 15 * MINUTE));
      await undo(recruiter).expect(200);
    });

    it("is refused for somebody else's change, even to a super admin, and to a viewer", async () => {
      expect((await detail(otherRecruiter)).undo).toBeNull();
      await undo(otherRecruiter).expect(409);
      await undo(superAdmin).expect(409);
      await undo(viewer).expect(403);
      await test.http().post(`${API}/admin/applications/${id}/undo-status`).expect(401);
      expect((await detail(recruiter)).status).toBe('UNDER_REVIEW');
    });

    it('only undoes the last change, once', async () => {
      await undo(recruiter).expect(200);
      // The submission itself is not a change a recruiter made.
      await undo(recruiter).expect(409);
    });

    it('is refused once the candidate has withdrawn in the meantime', async () => {
      await as(test, candidate).post(`/me/applications/${id}/withdraw`).expect(200);
      await undo(recruiter).expect(409);
      expect((await detail(recruiter)).status).toBe('WITHDRAWN');
    });

    it('frees the position again when a deployment is undone', async () => {
      for (const status of [
        'SHORTLISTED',
        'INTERVIEW',
        'OFFER',
        'CONTRACT_SIGNED',
        'VISA_PROCESSING',
        'VISA_APPROVED',
        'DEPLOYED',
      ]) {
        await as(test, recruiter).patch(`/admin/applications/${id}/status`, { status }).expect(200);
      }
      expect((await test.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).hiredCount).toBe(
        1,
      );
      const body = (await undo(recruiter).expect(200)).body as Detail;
      expect(body.status).toBe('VISA_APPROVED');
      expect((await test.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).hiredCount).toBe(
        0,
      );
    });

    it('does not count an undone visa approval in the dashboard', async () => {
      for (const status of [
        'SHORTLISTED',
        'INTERVIEW',
        'OFFER',
        'CONTRACT_SIGNED',
        'VISA_PROCESSING',
        'VISA_APPROVED',
      ]) {
        await as(test, recruiter).patch(`/admin/applications/${id}/status`, { status }).expect(200);
      }
      const stats = async () =>
        (await as(test, viewer).get('/admin/stats').expect(200)).body as {
          visasApprovedThisYear: number;
          newApplicationsThisWeek: number;
        };
      expect((await stats()).visasApprovedThisYear).toBe(1);
      await undo(recruiter).expect(200);
      expect(await stats()).toMatchObject({ visasApprovedThisYear: 0, newApplicationsThisWeek: 1 });
    });
  });

  describe('contact messages inbox', () => {
    const send = (name: string, subject: string) =>
      test
        .http()
        .post(`${API}/contact`)
        .send({
          name,
          email: `${name.toLowerCase()}@example.test`,
          subject,
          message: 'I would like to know more about the jobs in Malta.',
          turnstileToken: 'ok',
        })
        .expect(202);
    interface Page {
      total: number;
      unhandled: number;
      items: { id: string; name: string; handledAt: string | null; message: string }[];
    }
    const list = async (user: TestUser, query = '') =>
      (await as(test, user).get(`/admin/contact-messages${query}`).expect(200)).body as Page;

    it('only stores a message while no contact address is set, and emails the address once set', async () => {
      // No placeholder address: the site shows nothing and nobody is emailed until the
      // super admin sets one.
      await as(test, superAdmin).put('/admin/settings/CONTACT_EMAIL', { value: '' }).expect(200);
      test.outbox.length = 0;
      await send('Amira', 'Visa');
      expect(test.outbox).toHaveLength(0);
      expect((await list(viewer)).total).toBe(1);
      const info = (await test.http().get(`${API}/site-info`).expect(200)).body as {
        CONTACT_EMAIL: string;
      };
      expect(info.CONTACT_EMAIL).toBe('');

      await as(test, superAdmin)
        .put('/admin/settings/CONTACT_EMAIL', { value: 'agency@example.test' })
        .expect(200);
      await send('Omar', 'Salary');
      expect(test.outbox.map((email) => email.to)).toEqual(['agency@example.test']);
      await as(test, superAdmin).put('/admin/settings/CONTACT_EMAIL', { value: '' }).expect(200);
    });

    it('lists the messages to every back-office role, newest first, with the number left to handle', async () => {
      await send('Amira', 'Visa');
      await send('Omar', 'Salary');
      for (const user of [viewer, recruiter, superAdmin]) {
        const page = await list(user);
        expect(page).toMatchObject({ total: 2, unhandled: 2 });
        expect(page.items.map((item) => item.name)).toEqual(['Omar', 'Amira']);
        expect(page.items[0]?.message).toContain('Malta');
      }
      expect((await list(viewer, '?q=sala')).items.map((item) => item.name)).toEqual(['Omar']);
    });

    it('lets a recruiter mark a message as handled and reopen it, with audit entries', async () => {
      await send('Amira', 'Visa');
      const [message] = (await list(recruiter)).items;
      const handled = await as(test, recruiter)
        .post(`/admin/contact-messages/${message?.id ?? ''}/handle`)
        .expect(200);
      expect((handled.body as { handledAt: string | null }).handledAt).not.toBeNull();
      expect(await list(recruiter, '?handled=false')).toMatchObject({ total: 0, unhandled: 0 });
      expect((await list(recruiter, '?handled=true')).total).toBe(1);

      await as(test, superAdmin)
        .post(`/admin/contact-messages/${message?.id ?? ''}/reopen`)
        .expect(200);
      expect((await list(recruiter)).unhandled).toBe(1);

      const entries = await test.prisma.auditLog.findMany({
        where: { entityType: 'contactMessage' },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((entry) => entry.action)).toEqual([
        'contact_message.handle',
        'contact_message.reopen',
      ]);
      // The audit log keeps the state, not the personal message.
      expect(JSON.stringify(entries)).not.toContain('amira@example.test');
    });

    it('lets a super admin delete a message for good; the audit log keeps nothing of it', async () => {
      await send('Amira', 'Visa');
      await send('Omar', 'Salary');
      const amira = (await list(superAdmin)).items.find((item) => item.name === 'Amira');
      const path = `/admin/contact-messages/${amira?.id ?? ''}`;
      await as(test, viewer).delete(path).expect(403);
      await as(test, recruiter).delete(path).expect(403);
      await test.http().delete(`${API}${path}`).expect(401);
      expect((await list(superAdmin)).total).toBe(2);

      await as(test, superAdmin).delete(path).expect(204);
      expect((await list(superAdmin)).items.map((item) => item.name)).toEqual(['Omar']);
      await as(test, superAdmin).delete(path).expect(404);

      const entries = await test.prisma.auditLog.findMany({
        where: { action: 'contact_message.delete' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorId: superAdmin.id, entityId: amira?.id });
      expect(JSON.stringify(entries)).not.toMatch(/amira|Visa|Malta/i);
    });

    it('refuses writes to a viewer, and everything to candidates and visitors', async () => {
      await send('Amira', 'Visa');
      const [message] = (await list(viewer)).items;
      await as(test, viewer)
        .post(`/admin/contact-messages/${message?.id ?? ''}/handle`)
        .expect(403);
      const candidate = await createUser(test, 'CANDIDATE');
      await as(test, candidate).get('/admin/contact-messages').expect(403);
      await test.http().get(`${API}/admin/contact-messages`).expect(401);
      await as(test, recruiter)
        .post('/admin/contact-messages/00000000-0000-4000-8000-000000000000/handle')
        .expect(404);
    });
  });

  describe('job alerts of an address', () => {
    const subscribe = (email: string) =>
      test.prisma.jobAlertSubscription.create({
        data: { email, unsubscribeToken: `token-${email}-${String(Math.random())}` },
      });

    it('lets a super admin remove every alert of an address; the audit log keeps the number only', async () => {
      await subscribe('hedi@example.test');
      await subscribe('hedi@example.test');
      await subscribe('other@example.test');
      const erase = (user: TestUser, email: string) =>
        as(test, user).post('/admin/job-alerts/erase').send({ email });

      await erase(viewer, 'hedi@example.test').expect(403);
      await erase(recruiter, 'hedi@example.test').expect(403);
      await test
        .http()
        .post(`${API}/admin/job-alerts/erase`)
        .send({ email: 'a@b.test' })
        .expect(401);
      await erase(superAdmin, 'not-an-address').expect(400);
      expect(await test.prisma.jobAlertSubscription.count()).toBe(3);

      // Written in any case: addresses are stored in lower case.
      expect((await erase(superAdmin, 'Hedi@Example.test').expect(200)).body).toEqual({
        removed: 2,
      });
      expect(
        (await test.prisma.jobAlertSubscription.findMany()).map((alert) => alert.email),
      ).toEqual(['other@example.test']);
      expect((await erase(superAdmin, 'hedi@example.test').expect(200)).body).toEqual({
        removed: 0,
      });

      const entries = await test.prisma.auditLog.findMany({ where: { action: 'job_alert.erase' } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorId: superAdmin.id, before: { alerts: 2 } });
      expect(JSON.stringify(entries)).not.toContain('hedi');
    });
  });

  describe('questions of a job', () => {
    const label = (text: string) => ({ en: text, fr: `${text} (fr)`, ar: `${text} (ar)` });
    const questions = [
      { id: 'night', type: 'YES_NO', required: true, label: label('Can you work at night?') },
      {
        id: 'level',
        type: 'SINGLE_CHOICE',
        required: false,
        label: label('Your welding level'),
        options: [
          { value: 'junior', label: label('Junior') },
          { value: 'senior', label: label('Senior') },
        ],
      },
      { id: 'tools', type: 'TEXT', required: false, label: label('Which tools do you use?') },
    ];
    const jobBody = () => ({
      title: 'MIG Welder',
      destinationId: catalog.destinations.POLAND,
      categoryId: catalog.categories.construction,
      description: '<p>Weld <strong>steel</strong> frames.</p><script>alert(1)</script>',
      deadline: daysFromNow(30).toISOString(),
      questions,
    });
    const createPublished = async () => {
      const created = await as(test, recruiter).post('/admin/jobs', jobBody()).expect(201);
      const job = created.body as {
        id: string;
        slug: string;
        questions: unknown[];
        description: string;
      };
      await as(test, recruiter).post(`/admin/jobs/${job.id}/publish`).expect(200);
      return job;
    };
    const apply = async (jobId: string, answers?: Record<string, string>) => {
      const candidate = await createReadyCandidate(test);
      const response = await test
        .http()
        .post(`${API}/jobs/${jobId}/apply`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .send({
          documentIds: [candidate.cvId, candidate.passportId],
          turnstileToken: 'ok',
          ...(answers ? { answers } : {}),
        });
      return { response, candidate };
    };

    it('stores the questions with the job, cleans the description and shows both on the public site', async () => {
      const job = await createPublished();
      expect(job.questions).toHaveLength(3);
      expect(job.description).toBe('<p>Weld <strong>steel</strong> frames.</p>');
      const shown = (await test.http().get(`${API}/jobs/${job.slug}`).expect(200)).body as {
        questions: { id: string; options: unknown[] }[];
      };
      expect(shown.questions.map((question) => question.id)).toEqual(['night', 'level', 'tools']);
      expect(shown.questions[1]?.options).toHaveLength(2);
    });

    it.each([
      [
        'a choice question without options',
        [{ id: 'q', type: 'SINGLE_CHOICE', label: label('Level') }],
      ],
      [
        'the same id twice',
        [
          { id: 'q', type: 'TEXT', label: label('One') },
          { id: 'q', type: 'TEXT', label: label('Two') },
        ],
      ],
      ['a label missing a language', [{ id: 'q', type: 'TEXT', label: { en: 'Only English' } }]],
      [
        'options on a yes/no question',
        [
          {
            id: 'q',
            type: 'YES_NO',
            label: label('Ok?'),
            options: [{ value: 'a', label: label('A') }],
          },
        ],
      ],
    ])('refuses %s', async (_name, bad) => {
      await as(test, recruiter)
        .post('/admin/jobs', { ...jobBody(), questions: bad })
        .expect(400);
    });

    it('refuses a viewer who tries to change the questions', async () => {
      const job = await createPublished();
      await as(test, viewer).patch(`/admin/jobs/${job.id}`, { questions: [] }).expect(403);
    });

    it('refuses an application that skips a required question or gives an impossible answer', async () => {
      const job = await createPublished();
      const paths = (body: unknown) =>
        (body as { details: { path: string }[] }).details.map((issue) => issue.path);

      const missing = await apply(job.id);
      expect(missing.response.status).toBe(400);
      expect(paths(missing.response.body)).toEqual(['answers.night']);

      const wrong = await apply(job.id, { night: 'maybe', level: 'expert', other: 'x' });
      expect(wrong.response.status).toBe(400);
      expect(paths(wrong.response.body).sort()).toEqual([
        'answers.level',
        'answers.night',
        'answers.other',
      ]);
      expect(await test.prisma.application.count()).toBe(0);
    });

    it('keeps the questions as asked with the application, shows them in the detail and in the export', async () => {
      const job = await createPublished();
      const { response } = await apply(job.id, {
        night: 'yes',
        level: 'senior',
        tools: '=MIG torch',
      });
      expect(response.status).toBe(201);
      const applicationId = (response.body as { id: string }).id;

      // The recruiter rewrites the questions afterwards: the application keeps what was asked.
      await as(test, recruiter).patch(`/admin/jobs/${job.id}`, { questions: [] }).expect(200);

      const detail = (
        await as(test, viewer).get(`/admin/applications/${applicationId}`).expect(200)
      ).body as Detail;
      expect(detail.questions.map((question) => question.id)).toEqual(['night', 'level', 'tools']);
      expect(detail.answers).toEqual({ night: 'yes', level: 'senior', tools: '=MIG torch' });

      const exported = await as(test, recruiter)
        .post('/admin/applications/export', { format: 'csv', columns: ['email', 'answers'] })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
        })
        .expect(200);
      const csv = (exported.body as Buffer).toString('utf8');
      expect(csv).toContain('Can you work at night?: Yes');
      expect(csv).toContain('Your welding level: Senior');
      expect(csv).toContain('Which tools do you use?: =MIG torch');
    });

    it('still accepts free answers for a job without questions', async () => {
      const job = await insertJob(test, catalog, { slug: 'plain' });
      const { response } = await apply(job.id, { 'Earliest start date': 'Next month' });
      expect(response.status).toBe(201);
    });

    it('copies the questions when a job is duplicated', async () => {
      const job = await createPublished();
      const copy = (await as(test, recruiter).post(`/admin/jobs/${job.id}/duplicate`).expect(201))
        .body as { questions: unknown[] };
      expect(copy.questions).toHaveLength(3);
    });
  });

  describe('social links', () => {
    it('are edited by a super admin only and published by site-info', async () => {
      await as(test, recruiter)
        .put('/admin/settings/SOCIAL_TIKTOK', { value: 'https://www.tiktok.com/@iconbridge' })
        .expect(403);
      await as(test, superAdmin)
        .put('/admin/settings/SOCIAL_TIKTOK', { value: 'javascript:alert(1)' })
        .expect(400);
      await as(test, superAdmin)
        .put('/admin/settings/SOCIAL_TIKTOK', { value: 'https://www.tiktok.com/@iconbridge' })
        .expect(200);
      const info = (await test.http().get(`${API}/site-info`).expect(200)).body as Record<
        string,
        string
      >;
      expect(info.SOCIAL_TIKTOK).toBe('https://www.tiktok.com/@iconbridge');
      expect(info.SOCIAL_FACEBOOK).toBe('');
    });
  });

  describe('audit log filters', () => {
    it('filters by action, record type, actor and day, for a super admin only', async () => {
      const job = await insertJob(test, catalog, { slug: 'job', status: 'DRAFT' });
      await as(test, recruiter).post(`/admin/jobs/${job.id}/publish`).expect(200);
      await as(test, superAdmin)
        .put('/admin/settings/CONTACT_PHONE', { value: '+356 2100 0000' })
        .expect(200);
      interface Page {
        total: number;
        items: { action: string; actorEmail: string | null; entityType: string }[];
      }
      const list = async (query: string) =>
        (await as(test, superAdmin).get(`/admin/audit-logs?${query}`).expect(200)).body as Page;

      expect((await list('action=publish')).items.map((item) => item.action)).toEqual([
        'job.publish',
      ]);
      expect((await list('entityType=job')).total).toBe(1);
      const byActor = await list(`actor=${encodeURIComponent(recruiter.email.slice(0, 12))}`);
      expect(byActor.items.every((item) => item.actorEmail === recruiter.email)).toBe(true);
      expect(byActor.total).toBeGreaterThan(0);
      const today = new Date().toISOString().slice(0, 10);
      expect((await list(`from=${today}&to=${today}`)).total).toBeGreaterThanOrEqual(2);
      expect((await list('to=2000-01-01')).total).toBe(0);

      await as(test, recruiter).get('/admin/audit-logs?action=job').expect(403);
      await as(test, superAdmin).get('/admin/audit-logs?from=yesterday').expect(400);
    });
  });
});
