import { MailService } from '../../src/mail/mail.service.js';
import { createTestApp, resetDatabase, type TestApp } from './app.js';

const MINUTE = 60_000;
const VARIABLES = { actionUrl: 'http://localhost:3000/en/verify-email?token=t' };

// Azure-managed email domains accept 5 emails a minute and 10 an hour. A refusal for
// quota is not a failure of the email: it waits, keeps its attempts, and the outbox stops
// sending until the wait is over. Own app: the pause is held by the MailService instance.
describe('email outbox, mail service over quota (e2e)', () => {
  let test: TestApp;
  let mail: MailService;
  const start = new Date('2026-05-04T09:00:00.000Z');

  beforeAll(async () => {
    test = await createTestApp();
    mail = test.app.get(MailService);
    await resetDatabase(test.prisma);
    test.clock.set(start);
  });
  afterAll(async () => {
    test.clock.reset();
    test.mailServer.throttleMs = 0;
    await test.close();
  });

  const rows = () => test.prisma.emailOutbox.findMany({ orderBy: { createdAt: 'asc' } });
  const at = (minutes: number) => {
    test.clock.set(new Date(start.getTime() + minutes * MINUTE));
  };

  it('postpones without counting an attempt, then sends everything once the wait is over', async () => {
    test.mailServer.throttleMs = 10 * MINUTE;
    // The first email is refused for quota (inline delivery tries it at once).
    await mail.send('one@example.test', 'verify-email', 'en', VARIABLES);
    const [first] = await rows();
    expect(first).toMatchObject({ status: 'PENDING', attempts: 0, lastError: 'MailThrottled' });
    expect(first?.nextAttemptAt).toEqual(new Date(start.getTime() + 10 * MINUTE));

    // During the wait nothing is handed to the mail service, new emails included.
    test.mailServer.throttleMs = 0;
    await mail.send('two@example.test', 'verify-email', 'en', VARIABLES);
    await mail.send('three@example.test', 'verify-email', 'en', VARIABLES);
    at(5);
    expect(await mail.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(test.outbox).toHaveLength(0);

    // The two new emails were never offered; the first one still has all its attempts.
    expect((await rows()).map((row) => row.attempts)).toEqual([0, 0, 0]);

    at(10);
    expect(await mail.sendDue()).toEqual({ sent: 3, retried: 0, failed: 0 });
    // Oldest due first: the postponed email is now due after the two new ones.
    expect(test.outbox.map((email) => email.to)).toEqual([
      'two@example.test',
      'three@example.test',
      'one@example.test',
    ]);
    expect((await rows()).map((row) => [row.status, row.attempts])).toEqual([
      ['SENT', 1],
      ['SENT', 1],
      ['SENT', 1],
    ]);
  });

  it('stops the batch at the first refusal instead of offering every email', async () => {
    await resetDatabase(test.prisma);
    test.outbox.length = 0;
    at(60);
    test.mailServer.down = true;
    for (const to of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      await mail.send(`${to}@example.test`, 'verify-email', 'en', VARIABLES);
    }
    test.mailServer.down = false;
    test.mailServer.throttleMs = 30 * MINUTE;
    at(61);
    const report = await mail.sendDue();
    // One group of concurrent sends is offered, then the outbox waits.
    expect(report.sent).toBe(0);
    expect(report.retried).toBeLessThanOrEqual(3);
    const offered = (await rows()).filter((row) => row.lastError === 'MailThrottled');
    expect(offered.length).toBe(report.retried);
    expect((await rows()).filter((row) => row.lastError === 'SmtpDown')).toHaveLength(
      7 - report.retried,
    );
  });
});
