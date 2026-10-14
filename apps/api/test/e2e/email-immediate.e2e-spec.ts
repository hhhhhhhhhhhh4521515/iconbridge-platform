// As in Azure: delivery in the background of the API, and no scheduler inside it.
// Read when the application module is loaded, so set before any import.
vi.hoisted(() => {
  process.env.MAIL_DELIVERY = 'background';
  process.env.SCHEDULER_ENABLED = 'false';
});

import { TasksService } from '../../src/tasks/tasks.service.js';
import { API, createTestApp, PASSWORD, resetDatabase, type TestApp } from './app.js';

const MINUTE = 60_000;

/**
 * In Azure the API runs with SCHEDULER_ENABLED=false and a Container Apps Job runs
 * the tasks every 15 minutes. A verification or password-reset email must not wait
 * for that job: the API sends it itself, right after the row of the outbox is
 * committed. Only an email that failed is left to the job.
 */
describe('emails leave at once without the scheduler (e2e)', () => {
  let test: TestApp;
  const start = new Date('2026-05-04T09:00:00.000Z');

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.MAIL_DELIVERY;
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

  const register = (email: string) =>
    test.http().post(`${API}/auth/register`).send({
      email,
      password: PASSWORD,
      firstName: 'Amira',
      lastName: 'Ben Salah',
      phone: '+21612345678',
      country: 'TN',
      gdprConsent: true,
      turnstileToken: 'ok',
      locale: 'en',
    });
  const rows = () => test.prisma.emailOutbox.findMany({ orderBy: { createdAt: 'asc' } });
  /** Waits for the background of the API, never for a task: no test here runs one before this. */
  const delivered = (count: number) =>
    vi.waitFor(
      () => {
        expect(test.outbox).toHaveLength(count);
      },
      { timeout: 5_000, interval: 20 },
    );

  it('sends the verification email right after the registration, with no task run', async () => {
    await register('amira@example.test').expect(201);
    await delivered(1);
    expect(test.outbox[0]?.to).toBe('amira@example.test');
    expect(test.outbox[0]?.text).toContain('/en/verify-email?token=');
    await vi.waitFor(async () => {
      expect(await rows()).toMatchObject([{ status: 'SENT', attempts: 1 }]);
    });
  });

  it('sends the password-reset email right after the request, with no task run', async () => {
    await register('amira@example.test').expect(201);
    await delivered(1);
    await test
      .http()
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'amira@example.test' })
      .expect(202);
    await delivered(2);
    expect(test.outbox[1]?.text).toContain('/en/reset-password?token=');
  });

  it('answers the request without waiting for the mail server', async () => {
    // A mail server that takes its time: the registration is answered before the email leaves.
    test.mailServer.delayMs = 400;
    try {
      await register('amira@example.test').expect(201);
      expect(test.outbox).toHaveLength(0);
      expect(await rows()).toMatchObject([{ status: 'PENDING' }]);
      await delivered(1);
    } finally {
      test.mailServer.delayMs = 0;
    }
  });

  it('leaves an email that failed to the scheduled job, which sends it when it is due', async () => {
    test.mailServer.down = true;
    await register('amira@example.test').expect(201);
    // Tried once by the API, at once.
    await vi.waitFor(async () => {
      expect(await rows()).toMatchObject([
        { status: 'PENDING', attempts: 1, lastError: 'SmtpDown' },
      ]);
    });
    expect(test.outbox).toHaveLength(0);

    // The mail server is back. Nothing inside the API tries again by itself...
    test.mailServer.down = false;
    test.clock.set(new Date(start.getTime() + 5 * MINUTE));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(test.outbox).toHaveLength(0);

    // ...the job does, as soon as the wait is over.
    const report = await test.app.get(TasksService).run('send-emails');
    expect(report).toMatchObject({ ok: true, result: { sent: 1, retried: 0, failed: 0 } });
    expect(test.outbox).toHaveLength(1);
    expect(test.outbox[0]?.text).toContain('/en/verify-email?token=');
  });
});
