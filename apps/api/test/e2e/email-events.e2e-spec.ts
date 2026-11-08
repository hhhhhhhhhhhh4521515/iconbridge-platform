import { createHash } from 'node:crypto';
import { TasksService } from '../../src/tasks/tasks.service.js';
import { API, createTestApp, createUser, resetDatabase, type TestApp } from './app.js';

/**
 * Delivery reports of Azure Communication Services through Event Grid (audit M2): the
 * subscription validation, the key, and no more email to an address that bounced.
 */
describe('email delivery reports (e2e)', () => {
  let test: TestApp;
  const KEY = 'e2e-email-events-key-0123456789abcdef';
  const hash = (email: string) => createHash('sha256').update(email.toLowerCase()).digest('hex');
  const report = (recipient: string, status: string) => ({
    eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
    data: { sender: 'noreply@example.test', recipient, messageId: 'm-1', status },
  });
  const post = (body: unknown, key: string | null = KEY) => {
    const request = test.http().post(`${API}/email-events`);
    return (key === null ? request : request.set('x-email-events-key', key)).send(body as object);
  };
  const forgot = (email: string) =>
    test
      .http()
      .post(`${API}/auth/forgot-password`)
      .send({ email, turnstileToken: 'ok' })
      .expect(202);

  beforeAll(async () => {
    test = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.outbox.length = 0;
    test.clock.reset();
  });
  afterAll(async () => {
    await test.close();
  });

  it('answers the subscription validation of Event Grid, even before the key is known', async () => {
    const response = await post(
      [
        {
          eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
          data: { validationCode: 'code-123', validationUrl: 'https://example.test/validate' },
        },
      ],
      null,
    ).expect(200);
    expect(response.body).toEqual({ validationResponse: 'code-123', suppressed: 0 });
  });

  it('refuses reports without the key or with another one, and malformed bodies', async () => {
    await post([report('a@example.test', 'Bounced')], null).expect(401);
    await post([report('a@example.test', 'Bounced')], 'x'.repeat(KEY.length)).expect(401);
    await post({ eventType: 'not a list' }).expect(400);
    expect(await test.prisma.emailSuppression.count()).toBe(0);
  });

  it('stops every email to an address that bounced, keeping only its fingerprint', async () => {
    const user = await createUser(test, 'CANDIDATE');
    const other = await createUser(test, 'CANDIDATE');

    // Delivered, filtered or failed for a while: nothing changes.
    for (const status of ['Delivered', 'FilteredSpam', 'Quarantined', 'Failed']) {
      expect((await post([report(user.email, status)]).expect(200)).body).toEqual({
        suppressed: 0,
      });
    }
    // Azure writes the address as it was given; the fingerprint ignores case.
    expect((await post([report(user.email.toUpperCase(), 'Bounced')]).expect(200)).body).toEqual({
      suppressed: 1,
    });

    const rows = await test.prisma.emailSuppression.findMany();
    expect(rows).toEqual([
      expect.objectContaining({ emailHash: hash(user.email), reason: 'BOUNCED' }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(user.email);

    await forgot(user.email);
    await forgot(other.email);
    // Only the other address receives its email; the suppressed one is cancelled, not sent.
    expect(test.outbox.map((email) => email.to)).toEqual([other.email]);
    const cancelled = await test.prisma.emailOutbox.findMany({
      where: { status: 'CANCELLED', lastError: 'SUPPRESSED' },
    });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.payload).toBe('');
  });

  it('records the addresses Azure itself suppresses', async () => {
    const user = await createUser(test, 'CANDIDATE');
    expect((await post([report(user.email, 'Suppressed')]).expect(200)).body).toEqual({
      suppressed: 1,
    });
    await forgot(user.email);
    expect(test.outbox).toHaveLength(0);
  });

  it('forgets a bounced address 24 months after the last report', async () => {
    test.clock.set(new Date('2024-01-01T00:00:00Z'));
    await post([report('old@example.test', 'Bounced')]).expect(200);
    test.clock.set(new Date('2025-12-31T00:00:00Z'));
    await post([report('recent@example.test', 'Bounced')]).expect(200);
    test.clock.set(new Date('2026-01-02T00:00:00Z'));
    const retention = await test.app.get(TasksService).run('retention');
    expect(retention).toMatchObject({ ok: true, result: { emailSuppressions: 1 } });
    expect((await test.prisma.emailSuppression.findMany()).map((row) => row.emailHash)).toEqual([
      hash('recent@example.test'),
    ]);
  });
});
