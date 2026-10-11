import { adminStatsSchema } from '@iconbridge/shared';
import { JobAlertsService } from '../../src/public-forms/job-alerts.service.js';
import { TaskLockService } from '../../src/tasks/task-lock.service.js';
import { TASK_NAMES, TasksService } from '../../src/tasks/tasks.service.js';
import {
  API,
  BAD_CAPTCHA,
  cookieHeader,
  createReadyCandidate,
  createTestApp,
  createUser,
  daysFromNow,
  insertJob,
  login,
  PASSWORD,
  resetDatabase,
  seedCatalog,
  tokenFrom,
  type Catalog,
  type TestApp,
  type TestUser,
} from './app.js';
import { advanceTo, applyTo, as, newApplication } from './back-office.js';

describe('candidates, settings, dashboard, job alerts, contact and tasks (e2e)', () => {
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
    catalog = await seedCatalog(test);
    viewer = await createUser(test, 'VIEWER');
    recruiter = await createUser(test, 'RECRUITER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');
    test.outbox.length = 0;
  });

  describe('candidates', () => {
    it('searches candidates with masked passport numbers, and never lists back-office or erased accounts', async () => {
      const amira = await createReadyCandidate(test, 'amira@example.test');
      await test.prisma.candidateProfile.update({
        where: { id: amira.profileId },
        data: { firstName: 'Amira', lastName: 'Zed', nationality: 'MA' },
      });
      await createReadyCandidate(test, 'omar@example.test');
      const erased = await createReadyCandidate(test, 'gone@example.test');
      await as(test, erased).delete('/me/account').send({ password: PASSWORD }).expect(204);

      const list = async (query = '') =>
        (await as(test, viewer).get(`/admin/candidates${query}`).expect(200)).body as {
          total: number;
          items: { email: string; passportNumberMasked: string }[];
        };
      const all = await list();
      expect(all.total).toBe(2);
      expect(all.items.map((item) => item.email).sort()).toEqual([
        'amira@example.test',
        'omar@example.test',
      ]);
      expect(JSON.stringify(all)).not.toContain('FAKE1234567');
      expect(all.items[0]?.passportNumberMasked).toBe('********567');
      expect((await list('?q=zed')).items.map((item) => item.email)).toEqual([
        'amira@example.test',
      ]);
      expect((await list('?q=OMAR@')).total).toBe(1);
      expect((await list('?nationality=MA')).total).toBe(1);
      expect((await list('?language=en')).total).toBe(2);
      expect((await list('?active=false')).total).toBe(0);
    });

    it('shows one candidate with profile, documents and applications, and audits the view', async () => {
      const job = await insertJob(test, catalog, { slug: 'job' });
      const { candidate, id } = await newApplication(test, job.id);
      const response = await as(test, viewer)
        .get(`/admin/candidates/${candidate.profileId}`)
        .expect(200);
      expect(response.body).toMatchObject({
        email: candidate.email,
        profile: { passportNumber: 'FAKE1234567', passportNumberMasked: '********567' },
        applications: [{ id, status: 'SUBMITTED' }],
      });
      expect((response.body as { documents: unknown[] }).documents).toHaveLength(2);

      const entry = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'candidate.view' },
      });
      expect(entry).toMatchObject({
        actorId: viewer.id,
        entityType: 'candidate',
        entityId: candidate.profileId,
      });
      expect(JSON.stringify(entry)).not.toContain('FAKE1234567');
      await as(test, viewer)
        .get('/admin/candidates/00000000-0000-4000-8000-000000000000')
        .expect(404);
    });

    it('disables a candidate account at once and enables it again; a viewer cannot', async () => {
      const candidate = await createReadyCandidate(test);
      await as(test, viewer).post(`/admin/candidates/${candidate.profileId}/disable`).expect(403);
      const disabled = await as(test, recruiter)
        .post(`/admin/candidates/${candidate.profileId}/disable`)
        .expect(200);
      expect(disabled.body).toMatchObject({ isActive: false });
      await as(test, candidate).get('/me/profile').expect(401);
      await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: candidate.email, password: PASSWORD })
        .expect(401);

      await as(test, recruiter).post(`/admin/candidates/${candidate.profileId}/enable`).expect(200);
      await login(test, candidate.email);
      // Not for back-office accounts.
      await as(test, recruiter).post(`/admin/candidates/${recruiter.id}/disable`).expect(404);
    });
  });

  describe('settings', () => {
    it('lets the super admin read and change settings, which apply at once', async () => {
      const settings = (await as(test, superAdmin).get('/admin/settings').expect(200))
        .body as Record<string, unknown>;
      expect(settings).toMatchObject({
        REAPPLY_COOLDOWN_MONTHS: 6,
        MAX_ACTIVE_APPLICATIONS: 5,
        MAX_UPLOAD_SIZE_MB: 5,
      });

      const updated = await as(test, superAdmin)
        .put('/admin/settings/REAPPLY_COOLDOWN_MONTHS', { value: 0 })
        .expect(200);
      expect(updated.body).toEqual({ key: 'REAPPLY_COOLDOWN_MONTHS', value: 0 });
      // With no waiting period, a candidate can apply again right after a rejection.
      const job = await insertJob(test, catalog, { slug: 'job' });
      const { candidate, id } = await newApplication(test, job.id);
      await as(test, recruiter)
        .patch(`/admin/applications/${id}/status`, { status: 'REJECTED' })
        .expect(200);
      await applyTo(test, candidate, job.id);
    });

    it('validates each value and refuses unknown keys', async () => {
      await as(test, superAdmin)
        .put('/admin/settings/REAPPLY_COOLDOWN_MONTHS', { value: -1 })
        .expect(400);
      await as(test, superAdmin)
        .put('/admin/settings/REAPPLY_COOLDOWN_MONTHS', { value: 'six' })
        .expect(400);
      await as(test, superAdmin)
        .put('/admin/settings/MAX_UPLOAD_SIZE_MB', { value: 500 })
        .expect(400);
      await as(test, superAdmin)
        .put('/admin/settings/CONTACT_EMAIL', { value: 'not-an-email' })
        .expect(400);
      await as(test, superAdmin).put('/admin/settings/UNKNOWN_KEY', { value: 1 }).expect(404);
      expect(await test.prisma.setting.count()).toBe(0);
    });

    it('is for the super admin only, and audited with before and after', async () => {
      for (const user of [viewer, recruiter]) {
        await as(test, user).get('/admin/settings').expect(403);
        await as(test, user)
          .put('/admin/settings/MAX_ACTIVE_APPLICATIONS', { value: 50 })
          .expect(403);
      }
      await as(test, superAdmin)
        .put('/admin/settings/MAX_ACTIVE_APPLICATIONS', { value: 3 })
        .expect(200);
      const entries = await test.prisma.auditLog.findMany({ where: { action: 'setting.update' } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: superAdmin.id,
        entityId: 'MAX_ACTIVE_APPLICATIONS',
        before: { value: 5 },
        after: { value: 3 },
      });
    });

    it('publishes the contact details, and nothing else, to the site', async () => {
      await as(test, superAdmin)
        .put('/admin/settings/CONTACT_EMAIL', { value: 'hello@agency.test' })
        .expect(200);
      await as(test, superAdmin)
        .put('/admin/settings/CONTACT_PHONE', { value: '+356 2100 0000' })
        .expect(200);
      const info = (await test.http().get(`${API}/site-info`).expect(200)).body as Record<
        string,
        unknown
      >;
      expect(info).toEqual({
        CONTACT_EMAIL: 'hello@agency.test',
        CONTACT_PHONE: '+356 2100 0000',
        CONTACT_WHATSAPP: '',
        CONTACT_ADDRESS: '',
        MAX_UPLOAD_SIZE_MB: 5,
      });
    });
  });

  describe('dashboard', () => {
    it('counts open jobs, applications per status, destination and month, visas and the average delay', async () => {
      const poland = await insertJob(test, catalog, {
        slug: 'welder',
        destination: 'POLAND',
        deadline: daysFromNow(400),
      });
      const malta = await insertJob(test, catalog, {
        slug: 'cook',
        destination: 'MALTA',
        deadline: daysFromNow(400),
      });
      await insertJob(test, catalog, { slug: 'closed', status: 'CLOSED' });

      const now = new Date();
      const twoMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 10, 12));
      test.clock.set(twoMonthsAgo);
      const approved = await newApplication(test, poland.id);
      test.clock.set(new Date(twoMonthsAgo.getTime() + 10 * 86_400_000)); // visa approved 10 days after applying
      await advanceTo(test, recruiter, approved.id, 'VISA_APPROVED');
      test.clock.reset();
      const rejected = await newApplication(test, poland.id);
      await as(test, recruiter)
        .patch(`/admin/applications/${rejected.id}/status`, { status: 'REJECTED' })
        .expect(200);
      await newApplication(test, malta.id);

      const stats = adminStatsSchema.parse(
        (await as(test, viewer).get('/admin/stats').expect(200)).body,
      );
      expect(stats.openJobs).toBe(2);
      expect(stats.applicationsByStatus).toMatchObject({
        SUBMITTED: 1,
        VISA_APPROVED: 1,
        REJECTED: 1,
        DEPLOYED: 0,
        UNDER_REVIEW: 0,
      });
      expect(stats.applicationsByDestination).toEqual([
        { code: 'MALTA', count: 1 },
        { code: 'POLAND', count: 2 },
        { code: 'CRUISE_SHIP', count: 0 },
      ]);
      expect(stats.applicationsByMonth).toHaveLength(12);
      const month = (date: Date) => date.toISOString().slice(0, 7);
      expect(stats.applicationsByMonth.at(-1)).toEqual({ month: month(now), count: 2 });
      expect(stats.applicationsByMonth.at(-3)).toEqual({ month: month(twoMonthsAgo), count: 1 });
      expect(stats.applicationsByMonth.reduce((sum, item) => sum + item.count, 0)).toBe(3);
      expect(stats.averageDaysToVisaApproved).toBe(10);
      expect(stats.visasApprovedThisYear).toBe(
        twoMonthsAgo.getUTCFullYear() === now.getUTCFullYear() ? 1 : 0,
      );
    });

    it('answers with zeros on an empty platform, and is closed to candidates', async () => {
      const stats = adminStatsSchema.parse(
        (await as(test, recruiter).get('/admin/stats').expect(200)).body,
      );
      expect(stats).toMatchObject({
        openJobs: 0,
        visasApprovedThisYear: 0,
        averageDaysToVisaApproved: null,
      });
      const candidate = await createUser(test, 'CANDIDATE');
      await as(test, candidate).get('/admin/stats').expect(403);
    });
  });

  describe('job alerts', () => {
    const alerts = () => test.app.get(JobAlertsService);
    const subscribe = (overrides: object = {}) =>
      test
        .http()
        .post(`${API}/job-alerts`)
        .send({
          email: 'Sub@Example.test',
          destinations: ['MALTA'],
          locale: 'fr',
          turnstileToken: 'ok',
          ...overrides,
        });
    const confirmed = async (overrides: object = {}) => {
      test.outbox.length = 0;
      await subscribe(overrides).expect(202);
      await test
        .http()
        .post(`${API}/job-alerts/confirm`)
        .send({ token: tokenFrom(test.outbox[0]) })
        .expect(204);
      test.outbox.length = 0;
    };

    it('double opt-in: nothing is sent until the address is confirmed', async () => {
      const response = await subscribe().expect(202);
      expect(response.body).toEqual({
        message: 'Check your inbox and confirm your email address to activate the alert.',
      });
      expect(test.outbox).toHaveLength(1);
      expect(test.outbox[0]).toMatchObject({ to: 'sub@example.test' });
      expect(test.outbox[0]?.subject).toContain('Confirmez votre alerte emploi');
      expect(test.outbox[0]?.text).toContain('/fr/job-alerts/confirm?token=');
      const token = tokenFrom(test.outbox[0]);

      await insertJob(test, catalog, { slug: 'new-malta', publishedAt: new Date() });
      test.outbox.length = 0;
      expect(await alerts().sendDue()).toMatchObject({ ran: true, emails: 0 });
      expect(test.outbox).toHaveLength(0);

      await test.http().post(`${API}/job-alerts/confirm`).send({ token }).expect(204);
      await test.http().post(`${API}/job-alerts/confirm`).send({ token }).expect(400); // once only
      const row = await test.prisma.jobAlertSubscription.findFirstOrThrow();
      expect(row.confirmedAt).toBeInstanceOf(Date);
      expect(row.confirmTokenHash).toBeNull();
    });

    it('sends one email with the new matching jobs, once', async () => {
      await insertJob(test, catalog, {
        slug: 'old-malta',
        title: 'Old Malta Job',
        publishedAt: daysFromNow(-1),
      });
      await confirmed();
      const later = new Date(Date.now() + 60_000);
      await insertJob(test, catalog, {
        slug: 'cook-malta',
        title: 'Line Cook',
        destination: 'MALTA',
        publishedAt: later,
      });
      await insertJob(test, catalog, {
        slug: 'waiter-malta',
        title: 'Waiter',
        destination: 'MALTA',
        publishedAt: later,
      });
      await insertJob(test, catalog, {
        slug: 'welder-poland',
        title: 'Welder',
        destination: 'POLAND',
        publishedAt: later,
      });
      await insertJob(test, catalog, {
        slug: 'draft-malta',
        title: 'Draft Job',
        destination: 'MALTA',
        status: 'DRAFT',
      });
      test.clock.set(new Date(later.getTime() + 60_000));

      expect(await alerts().sendDue()).toMatchObject({
        ran: true,
        subscribers: 1,
        emails: 1,
        jobsAnnounced: 2,
      });
      expect(test.outbox).toHaveLength(1);
      const email = test.outbox[0];
      expect(email?.to).toBe('sub@example.test');
      expect(email?.subject).toContain('2 nouvelles offres');
      expect(email?.text).toContain('Line Cook: http://localhost:3000/fr/jobs/cook-malta');
      expect(email?.text).toContain('Waiter');
      for (const absent of ['Welder', 'Old Malta Job', 'Draft Job']) {
        expect(email?.text).not.toContain(absent);
      }
      expect(email?.text).toMatch(/\/fr\/job-alerts\/unsubscribe\?token=[A-Za-z0-9_-]{43}/);

      // The next run has nothing new for this subscriber.
      test.outbox.length = 0;
      expect(await alerts().sendDue()).toMatchObject({ emails: 0 });
      expect(test.outbox).toHaveLength(0);
    });

    it('follows every destination and category when none is chosen', async () => {
      await confirmed({ destinations: [], categories: [] });
      const later = new Date(Date.now() + 60_000);
      await insertJob(test, catalog, { slug: 'a', destination: 'MALTA', publishedAt: later });
      await insertJob(test, catalog, {
        slug: 'b',
        destination: 'POLAND',
        category: 'transport',
        publishedAt: later,
      });
      test.clock.set(new Date(later.getTime() + 60_000));
      expect(await alerts().sendDue()).toMatchObject({ jobsAnnounced: 2 });
    });

    it('retries at the next run when the email could not be sent', async () => {
      await confirmed();
      await insertJob(test, catalog, {
        slug: 'cook-malta',
        publishedAt: new Date(Date.now() + 60_000),
      });
      test.clock.set(new Date(Date.now() + 120_000));
      const mail = test.app.get((await import('../../src/mail/mail.service.js')).MailService);
      const send = vi.spyOn(mail, 'send').mockResolvedValueOnce(false);
      expect(await alerts().sendDue()).toMatchObject({ emails: 0 });
      send.mockRestore();
      expect(await alerts().sendDue()).toMatchObject({ emails: 1 });
    });

    it('unsubscribes with the link of the email', async () => {
      await confirmed();
      const { unsubscribeToken } = await test.prisma.jobAlertSubscription.findFirstOrThrow();
      await test
        .http()
        .post(`${API}/job-alerts/unsubscribe`)
        .send({ token: 'x'.repeat(43) })
        .expect(400);
      await test
        .http()
        .post(`${API}/job-alerts/unsubscribe`)
        .send({ token: unsubscribeToken })
        .expect(204);
      expect(await test.prisma.jobAlertSubscription.count()).toBe(0);
      await insertJob(test, catalog, {
        slug: 'cook-malta',
        publishedAt: new Date(Date.now() + 60_000),
      });
      test.clock.set(new Date(Date.now() + 120_000));
      expect(await alerts().sendDue()).toMatchObject({ emails: 0 });
    });

    it('refuses an expired confirmation link and cleans up requests never confirmed', async () => {
      await subscribe().expect(202);
      const token = tokenFrom(test.outbox[0]);
      test.clock.set(daysFromNow(4));
      await test.http().post(`${API}/job-alerts/confirm`).send({ token }).expect(400);
      expect(await alerts().sendDue()).toMatchObject({ expiredRequestsRemoved: 1 });
      expect(await test.prisma.jobAlertSubscription.count()).toBe(0);
    });

    it('needs a CAPTCHA and a valid body', async () => {
      await subscribe({ turnstileToken: BAD_CAPTCHA }).expect(400);
      await subscribe({ email: 'nope' }).expect(400);
      await subscribe({ locale: 'de' }).expect(400);
      expect(await test.prisma.jobAlertSubscription.count()).toBe(0);
      expect(test.outbox).toHaveLength(0);
    });
  });

  describe('contact form', () => {
    const message = (overrides: object = {}) => ({
      name: 'Karim',
      email: 'Karim@Example.test',
      phone: '+21698765432',
      subject: 'Question about Malta',
      message: 'Hello, do you help with the visa application?',
      turnstileToken: 'ok',
      ...overrides,
    });

    it('stores the message and emails it to the agency, with the sender as reply-to', async () => {
      await as(test, superAdmin)
        .put('/admin/settings/CONTACT_EMAIL', { value: 'agency@example.test' })
        .expect(200);
      const response = await test.http().post(`${API}/contact`).send(message()).expect(202);
      expect(response.body).toEqual({
        message: 'Your message has been sent. We will answer by email.',
      });

      const stored = await test.prisma.contactMessage.findFirstOrThrow();
      expect(stored).toMatchObject({
        name: 'Karim',
        email: 'karim@example.test',
        subject: 'Question about Malta',
        handledAt: null,
      });
      expect(stored.ip).toBeTruthy();

      expect(test.outbox).toHaveLength(1);
      const email = test.outbox[0] as (typeof test.outbox)[number] & { replyTo?: string };
      expect(email.to).toBe('agency@example.test');
      expect(email.replyTo).toBe('karim@example.test');
      expect(email.subject).toContain('Question about Malta');
      expect(email.text).toContain('do you help with the visa application?');
      expect(email.text).toContain('Karim <karim@example.test>');
    });

    it('escapes HTML written in the message', async () => {
      await test
        .http()
        .post(`${API}/contact`)
        .send(message({ message: '<script>alert(1)</script> and <b>more</b>' }))
        .expect(202);
      expect(test.outbox[0]?.html).not.toContain('<script>alert(1)</script>');
      expect(test.outbox[0]?.html).toContain('&lt;script&gt;');
    });

    it('needs a CAPTCHA and a valid body, and stores nothing otherwise', async () => {
      expect(
        (
          await test
            .http()
            .post(`${API}/contact`)
            .send(message({ turnstileToken: BAD_CAPTCHA }))
            .expect(400)
        ).body,
      ).toMatchObject({ code: 'CAPTCHA_FAILED' });
      await test
        .http()
        .post(`${API}/contact`)
        .send(message({ message: 'short' }))
        .expect(400);
      await test
        .http()
        .post(`${API}/contact`)
        .send(message({ email: 'nope' }))
        .expect(400);
      expect(await test.prisma.contactMessage.count()).toBe(0);
      expect(test.outbox).toHaveLength(0);
    });
  });

  describe('scheduled tasks', () => {
    it('exposes every task by name and runs them all, reporting each', async () => {
      expect([...TASK_NAMES]).toEqual(['close-jobs', 'job-alerts']);
      await insertJob(test, catalog, { slug: 'expired', deadline: daysFromNow(-1) });
      const reports = await test.app.get(TasksService).runAll();
      expect(reports).toEqual([
        expect.objectContaining({ task: 'close-jobs', ok: true, ran: true }),
        expect.objectContaining({ task: 'job-alerts', ok: true, ran: true }),
      ]);
      expect((await test.prisma.job.findUniqueOrThrow({ where: { slug: 'expired' } })).status).toBe(
        'CLOSED',
      );
    });

    it('reports a failing task without stopping the others', async () => {
      const tasks = test.app.get(TasksService);
      const failing = vi
        .spyOn(test.app.get(JobAlertsService), 'sendDue')
        .mockRejectedValueOnce(new Error('smtp down'));
      const reports = await tasks.runAll();
      failing.mockRestore();
      expect(reports.map((report) => [report.task, report.ok])).toEqual([
        ['close-jobs', true],
        ['job-alerts', false],
      ]);
    });

    it('lets only one instance run a task at a time; the others skip', async () => {
      const locks = test.app.get(TaskLockService);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started: () => void = () => undefined;
      const running = new Promise<void>((resolve) => {
        started = resolve;
      });
      const first = locks.runExclusive('job-alerts', async () => {
        started();
        await held;
        return 'done';
      });
      await running;
      // The command line (or another replica) starts the same task meanwhile.
      expect(await test.app.get(JobAlertsService).sendDue()).toEqual({ ran: false });
      expect(await locks.runExclusive('job-alerts', () => Promise.resolve('second'))).toEqual({
        ran: false,
      });
      // A different task is not blocked.
      expect(await locks.runExclusive('another-task', () => Promise.resolve('other'))).toEqual({
        ran: true,
        result: 'other',
      });
      release();
      expect(await first).toEqual({ ran: true, result: 'done' });
      expect(await test.app.get(JobAlertsService).sendDue()).toMatchObject({ ran: true });
    });

    it('does not run in-process when the scheduler is disabled, as in Azure', async () => {
      // The e2e environment sets SCHEDULER_ENABLED=false.
      await insertJob(test, catalog, { slug: 'expired', deadline: daysFromNow(-1) });
      await test.app.get(TasksService).scheduled();
      expect((await test.prisma.job.findUniqueOrThrow({ where: { slug: 'expired' } })).status).toBe(
        'PUBLISHED',
      );
    });
  });

  it('keeps every new admin route closed to candidates', async () => {
    const candidate = await createUser(test, 'CANDIDATE');
    for (const path of [
      '/admin/applications',
      '/admin/candidates',
      '/admin/stats',
      '/admin/settings',
      '/admin/success-stories',
      '/admin/home-slides',
    ]) {
      await test
        .http()
        .get(`${API}${path}`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .expect(403);
      await test.http().get(`${API}${path}`).expect(401);
    }
  });
});
