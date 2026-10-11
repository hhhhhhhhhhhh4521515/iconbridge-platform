import { MailService, OUTBOX_MAX_ATTEMPTS } from '../../src/mail/mail.service.js';
import { TasksService } from '../../src/tasks/tasks.service.js';
import {
  createTestApp,
  createUser,
  insertJob,
  resetDatabase,
  seedCatalog,
  type TestApp,
} from './app.js';
import { as, newApplication } from './back-office.js';

const MINUTE = 60_000;
const VARIABLES = { actionUrl: 'http://localhost:3000/en/verify-email?token=secret-token-123' };

describe('email outbox (e2e)', () => {
  let test: TestApp;
  let mail: MailService;
  const start = new Date('2026-05-04T09:00:00.000Z');

  beforeAll(async () => {
    test = await createTestApp();
    mail = test.app.get(MailService);
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.clock.set(start);
    test.mailServer.down = false;
    test.outbox.length = 0;
  });
  afterEach(() => {
    test.clock.reset();
    test.mailServer.down = false;
  });

  const rows = () => test.prisma.emailOutbox.findMany({ orderBy: { createdAt: 'asc' } });
  const at = (minutes: number) => {
    test.clock.set(new Date(start.getTime() + minutes * MINUTE));
  };

  it('sends an email, marks it sent and forgets its content', async () => {
    expect(await mail.send('amira@example.test', 'verify-email', 'en', VARIABLES)).toBe(true);
    expect(test.outbox).toHaveLength(1);
    expect(test.outbox[0]?.to).toBe('amira@example.test');
    expect(test.outbox[0]?.text).toContain('token=secret-token-123');
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'SENT', attempts: 1, payload: '', lastError: null });
    expect(row?.sentAt).toEqual(start);
  });

  it('never stores the recipient or the one-time link in clear', async () => {
    test.mailServer.down = true;
    await mail.send('amira@example.test', 'verify-email', 'en', VARIABLES);
    const [row] = await rows();
    expect(row?.status).toBe('PENDING');
    expect(row?.payload.length).toBeGreaterThan(40);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('amira@example.test');
    expect(stored).not.toContain('secret-token-123');
  });

  it('keeps an email when the mail server is down and sends it when it is back', async () => {
    test.mailServer.down = true;
    // The request itself succeeds: the caller is told the email is accepted.
    expect(await mail.send('amira@example.test', 'verify-email', 'fr', VARIABLES)).toBe(true);
    expect(test.outbox).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'SmtpDown',
    });

    // Not before its next attempt, one minute later.
    test.mailServer.down = false;
    expect(await mail.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0 });
    at(1);
    expect(await mail.sendDue()).toEqual({ sent: 1, retried: 0, failed: 0 });
    expect(test.outbox).toHaveLength(1);
    expect(test.outbox[0]?.subject).toMatch(/Confirmez/);
    expect((await rows())[0]).toMatchObject({ status: 'SENT', attempts: 2 });
    // Sent once: another run finds nothing.
    at(600);
    expect(await mail.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(test.outbox).toHaveLength(1);
  });

  it('waits longer after each failure and gives up after the last attempt', async () => {
    test.mailServer.down = true;
    await mail.send('amira@example.test', 'verify-email', 'en', VARIABLES);
    let minutes = 0;
    const waits: number[] = [];
    for (let attempt = 2; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      const [row] = await rows();
      const wait = ((row?.nextAttemptAt.getTime() ?? 0) - start.getTime()) / MINUTE - minutes;
      waits.push(wait);
      // One second too early: nothing is tried.
      test.clock.set(new Date((row?.nextAttemptAt.getTime() ?? 0) - 1000));
      expect((await mail.sendDue()).retried + (await mail.sendDue()).failed).toBe(0);
      minutes += wait;
      at(minutes);
      const report = await mail.sendDue();
      expect(report.retried + report.failed).toBe(1);
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 64]);
    const [row] = await rows();
    expect(row).toMatchObject({
      status: 'FAILED',
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: 'SmtpDown',
      payload: '',
    });
    // Abandoned for good, even when the server comes back.
    test.mailServer.down = false;
    at(100_000);
    expect(await mail.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(test.outbox).toHaveLength(0);
  });

  it('gives each email to one runner only when several run at the same time', async () => {
    test.mailServer.down = true;
    for (let index = 0; index < 5; index++) {
      await mail.send(`c${String(index)}@example.test`, 'verify-email', 'en', VARIABLES);
    }
    test.mailServer.down = false;
    at(1);
    const reports = await Promise.all([mail.sendDue(), mail.sendDue(), mail.sendDue()]);
    expect(reports.reduce((total, report) => total + report.sent, 0)).toBe(5);
    expect(test.outbox).toHaveLength(5);
    expect(new Set(test.outbox.map((email) => email.to)).size).toBe(5);
  });

  it('takes back an email whose attempt was interrupted, once its lease has ended', async () => {
    test.mailServer.down = true;
    await mail.send('amira@example.test', 'verify-email', 'en', VARIABLES);
    // As if the process had died in the middle of an attempt.
    await test.prisma.emailOutbox.updateMany({
      data: { lastError: null, nextAttemptAt: new Date(start.getTime() + 2 * MINUTE) },
    });
    test.mailServer.down = false;
    at(1);
    expect((await mail.sendDue()).sent).toBe(0);
    expect(await mail.cancel((await rows())[0]?.id ?? '')).toBe(false);
    at(2);
    expect((await mail.sendDue()).sent).toBe(1);
  });

  it('cancels an email that has not left, and not one already sent', async () => {
    const sent = await mail.enqueue('a@example.test', 'verify-email', 'en', VARIABLES);
    test.mailServer.down = true;
    const waiting = await mail.enqueue('b@example.test', 'verify-email', 'en', VARIABLES);
    test.mailServer.down = false;
    expect(await mail.statusOf(sent)).toBe('SENT');
    expect(await mail.cancel(sent)).toBe(false);
    expect(await mail.cancel(waiting)).toBe(true);
    expect(await mail.statusOf(waiting)).toBe('CANCELLED');
    expect(await mail.statusOf('00000000-0000-4000-8000-000000000000')).toBeNull();
    at(10);
    await mail.sendDue();
    expect(test.outbox.map((email) => email.to)).toEqual(['a@example.test']);
  });

  it('is run by the task runner, which also removes old rows', async () => {
    test.mailServer.down = true;
    await mail.send('amira@example.test', 'verify-email', 'en', VARIABLES);
    test.mailServer.down = false;
    at(1);
    const report = await test.app.get(TasksService).run('send-emails');
    expect(report).toMatchObject({ ok: true, ran: true, result: { sent: 1, purged: 0 } });
    expect(test.outbox).toHaveLength(1);

    test.clock.reset();
    await test.prisma.$executeRaw`UPDATE email_outbox SET updated_at = now() - interval '31 days'`;
    expect((await test.app.get(TasksService).run('send-emails')).result).toMatchObject({
      purged: 1,
    });
    expect(await test.prisma.emailOutbox.count()).toBe(0);
  });

  it('a bulk status change of many applications does not depend on the mail server', async () => {
    test.clock.reset();
    const catalog = await seedCatalog(test);
    const recruiter = await createUser(test, 'RECRUITER');
    const job = await insertJob(test, catalog, { slug: 'job', positions: 50 });
    const ids: string[] = [];
    for (let index = 0; index < 12; index++) {
      ids.push((await newApplication(test, job.id)).id);
    }
    test.outbox.length = 0;
    await test.prisma.emailOutbox.deleteMany();
    test.mailServer.down = true;
    const response = await as(test, recruiter)
      .post('/admin/applications/bulk-status', { ids, status: 'UNDER_REVIEW' })
      .expect(200);
    expect(response.body).toMatchObject({ changed: 12, failed: 0 });
    expect(await test.prisma.emailOutbox.count({ where: { status: 'PENDING' } })).toBe(12);

    // The server comes back: every candidate gets the email, none twice.
    test.mailServer.down = false;
    test.clock.set(new Date(Date.now() + 2 * MINUTE));
    expect((await mail.sendDue()).sent).toBe(12);
    expect(new Set(test.outbox.map((email) => email.to)).size).toBe(12);
  });
});
