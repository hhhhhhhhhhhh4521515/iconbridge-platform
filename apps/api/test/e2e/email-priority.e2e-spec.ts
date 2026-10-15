import { MailService } from '../../src/mail/mail.service.js';
import type { EmailTemplate } from '../../src/mail/mail.templates.js';
import { createTestApp, resetDatabase, type TestApp } from './app.js';

// ConfigModule reads the environment when AppModule is imported: set the quota first.
const previousQuota = vi.hoisted(() => {
  const previous = process.env['EMAIL_HOURLY_QUOTA'];
  process.env['EMAIL_HOURLY_QUOTA'] = '10';
  return previous;
});

const MINUTE = 60_000;
const VARIABLES = {
  actionUrl: 'http://localhost:3000/en/account',
  expiresInHours: 24,
  jobTitle: 'E2E Welder',
  links: [{ label: 'E2E Welder', url: 'http://localhost:3000/en/jobs/e2e-welder' }],
  unsubscribeUrl: 'http://localhost:3000/en/job-alerts/unsubscribe?token=t',
};

// With an Azure-managed domain the mail service takes 10 emails an hour (ADR-014). The
// outbox spends them on what people wait for first, and job alerts never take more than
// half of an hour's quota.
describe('email outbox priorities and job-alert cap (e2e)', () => {
  let test: TestApp;
  let mail: MailService;
  const start = new Date('2026-05-04T09:00:00.000Z');
  beforeAll(async () => {
    test = await createTestApp();
    mail = test.app.get(MailService);
  });
  afterAll(async () => {
    test.clock.reset();
    test.mailServer.down = false;
    await test.close();
    if (previousQuota === undefined) {
      delete process.env['EMAIL_HOURLY_QUOTA'];
    } else {
      process.env['EMAIL_HOURLY_QUOTA'] = previousQuota;
    }
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.clock.set(start);
    test.mailServer.down = false;
    test.outbox.length = 0;
  });

  const at = (minutes: number) => {
    test.clock.set(new Date(start.getTime() + minutes * MINUTE));
  };
  /** Queues emails while the mail server is down: all due again one minute later. */
  const queue = async (entries: [EmailTemplate, string][]) => {
    test.mailServer.down = true;
    for (const [template, to] of entries) {
      await mail.send(`${to}@example.test`, template, 'en', VARIABLES);
    }
    test.mailServer.down = false;
  };
  const sentTo = () => test.outbox.map((email) => email.to.replace('@example.test', ''));
  /** Emails are sent three at a time, so within one group the finishing order is free. */
  const sorted = (names: string[]) => [...names].sort();

  it('sends account emails first, then applications, then job alerts and recruiter notices', async () => {
    await queue([
      ['job-alert', 'alert'],
      ['new-application', 'recruiter'],
      ['application-status', 'status'],
      ['verify-email', 'verify'],
      ['application-received', 'received'],
      ['reset-password', 'reset'],
      ['application-status-correction', 'correction'],
      ['invitation', 'invitation'],
    ]);
    const priorities = await test.prisma.emailOutbox.findMany({
      orderBy: { createdAt: 'asc' },
      select: { template: true, priority: true },
    });
    expect(priorities.map((row) => row.priority)).toEqual([3, 3, 2, 1, 2, 1, 2, 1]);

    at(1);
    // One email per run, so the order of the hand-overs is the order of the queue.
    for (let run = 0; run < 8; run++) {
      expect(await mail.sendDue(1)).toEqual({ sent: 1, retried: 0, failed: 0 });
    }
    // Within a priority, the oldest first.
    expect(sentTo()).toEqual([
      'verify',
      'reset',
      'invitation',
      'status',
      'received',
      'correction',
      'alert',
      'recruiter',
    ]);
  });

  it('a run of a few emails takes the most urgent ones, even if older bulk is waiting', async () => {
    await queue([
      ['job-alert', 'alert-1'],
      ['job-alert', 'alert-2'],
      ['new-application', 'recruiter'],
      ['reset-password', 'reset'],
    ]);
    at(1);
    expect(await mail.sendDue(2)).toEqual({ sent: 2, retried: 0, failed: 0 });
    expect(sorted(sentTo())).toEqual(['alert-1', 'reset']);
  });

  it('job alerts use at most half the hourly quota; other emails are not held back', async () => {
    await queue([
      ...Array.from({ length: 8 }, (_, index): [EmailTemplate, string] => [
        'job-alert',
        `alert-${index + 1}`,
      ]),
      ['verify-email', 'verify'],
      ['new-application', 'recruiter'],
    ]);
    at(1);
    expect(await mail.sendDue()).toEqual({ sent: 7, retried: 0, failed: 0 });
    // Groups of three: the account email first, five alerts, then the recruiter notice,
    // which the cap does not hold back.
    expect(sorted(sentTo().slice(0, 3))).toEqual(['alert-1', 'alert-2', 'verify']);
    expect(sorted(sentTo().slice(3, 6))).toEqual(['alert-3', 'alert-4', 'alert-5']);
    expect(sentTo()[6]).toBe('recruiter');

    // The other three wait, whoever runs the outbox, until the first alerts are an hour old.
    expect(await mail.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0 });
    at(60);
    expect(await mail.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0 });
    const waiting = await test.prisma.emailOutbox.count({ where: { status: 'PENDING' } });
    expect(waiting).toBe(3);

    // An urgent email is not held back by the cap.
    await mail.send('reset@example.test', 'reset-password', 'en', VARIABLES);
    expect(sentTo().at(-1)).toBe('reset');

    at(61.5);
    expect(await mail.sendDue()).toEqual({ sent: 3, retried: 0, failed: 0 });
    expect(sorted(sentTo().slice(-3))).toEqual(['alert-6', 'alert-7', 'alert-8']);
  });

  it('counts a job alert sent inline against the cap too', async () => {
    for (let index = 1; index <= 6; index++) {
      await mail.send(`alert-${index}@example.test`, 'job-alert', 'en', VARIABLES);
    }
    expect(sentTo()).toEqual(['alert-1', 'alert-2', 'alert-3', 'alert-4', 'alert-5']);
    expect(await test.prisma.emailOutbox.count({ where: { status: 'PENDING' } })).toBe(1);
  });
});
