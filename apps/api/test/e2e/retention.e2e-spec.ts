import { RETENTION_MONTHS, RETENTION_NOTICE_DAYS } from '@iconbridge/shared';
import { RetentionService } from '../../src/account/retention.service.js';
import { TasksService } from '../../src/tasks/tasks.service.js';
import {
  createReadyCandidate,
  createTestApp,
  createUser,
  insertJob,
  login,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type ReadyCandidate,
  type TestApp,
} from './app.js';
import { advanceTo, applyTo, as } from './back-office.js';

const DAY = 24 * 3_600_000;
const NOW = new Date('2026-09-01T08:00:00.000Z');

describe('data retention (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let retention: RetentionService;
  let candidate: ReadyCandidate;

  beforeAll(async () => {
    test = await createTestApp();
    retention = test.app.get(RetentionService);
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.clock.reset();
    test.privateFiles.clear();
    catalog = await seedCatalog(test);
    candidate = await createReadyCandidate(test, 'amira.khelifi@example.test');
    test.outbox.length = 0;
    test.clock.set(NOW);
  });
  afterEach(() => {
    test.clock.reset();
  });

  /** Months before NOW, minus some days. */
  const ago = (months: number, days = 0) => {
    const date = new Date(NOW);
    date.setUTCMonth(date.getUTCMonth() - months);
    return new Date(date.getTime() - days * DAY);
  };
  /** Puts the last activity of the candidate at a date: registration and last sign-in. */
  const lastSeen = (date: Date, userId = candidate.id) =>
    test.prisma.user.update({
      where: { id: userId },
      data: { createdAt: date, lastLoginAt: date },
    });
  const user = () => test.prisma.user.findUniqueOrThrow({ where: { id: candidate.id } });

  it('leaves an active or recently seen candidate alone', async () => {
    await lastSeen(ago(RETENTION_MONTHS, -RETENTION_NOTICE_DAYS - 1));
    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 0 });
    expect(test.outbox).toHaveLength(0);
    expect((await user()).retentionWarnedAt).toBeNull();
  });

  it('warns once, 30 days before the two years, in the language of the candidate', async () => {
    await test.prisma.user.update({ where: { id: candidate.id }, data: { locale: 'fr' } });
    await lastSeen(ago(RETENTION_MONTHS, -RETENTION_NOTICE_DAYS + 1));
    expect(await retention.run()).toEqual({ ran: true, warned: 1, erased: 0 });
    expect(test.outbox).toHaveLength(1);
    expect(test.outbox[0]?.to).toBe(candidate.email);
    expect(test.outbox[0]?.subject).toContain('Votre compte sera bientôt supprimé');
    // The date of the erasure is written in the email: at least the full notice from today.
    expect(test.outbox[0]?.text).toMatch(/1(er)? octobre 2026|30 septembre 2026/);
    expect(test.outbox[0]?.text).toContain('/fr/login');
    expect((await user()).retentionWarnedAt).toEqual(NOW);

    // No second email at the next runs, and no erasure before the notice has passed.
    test.clock.set(new Date(NOW.getTime() + 10 * DAY));
    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 0 });
    expect(test.outbox).toHaveLength(1);
    expect((await user()).deletedAt).toBeNull();
  });

  it('erases the account after the notice: files, personal data, and an audit entry without them', async () => {
    const job = await insertJob(test, catalog, { slug: 'welder', positions: 2 });
    const recruiter = await createUser(test, 'RECRUITER');
    test.clock.reset();
    const applicationId = await applyTo(test, candidate, job.id);
    await advanceTo(test, recruiter, applicationId, 'DEPLOYED');
    test.clock.set(NOW);
    await test.prisma.application.updateMany({ data: { updatedAt: ago(RETENTION_MONTHS, 5) } });
    await lastSeen(ago(RETENTION_MONTHS, 5));
    expect(test.privateFiles.size).toBe(2);
    test.outbox.length = 0;

    expect(await retention.run()).toEqual({ ran: true, warned: 1, erased: 0 });
    // The two years have passed, but the candidate was only just told: not yet.
    test.clock.set(new Date(NOW.getTime() + (RETENTION_NOTICE_DAYS - 1) * DAY));
    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 0 });
    test.clock.set(new Date(NOW.getTime() + RETENTION_NOTICE_DAYS * DAY));
    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 1 });

    expect(test.privateFiles.size).toBe(0);
    const erased = await test.prisma.candidateProfile.findUniqueOrThrow({
      where: { id: candidate.profileId },
      include: { user: true },
    });
    expect(erased).toMatchObject({ firstName: 'Deleted', lastName: 'User', phone: null });
    expect(erased.user.deletedAt).not.toBeNull();
    expect(erased.user.email).toMatch(/@deleted\.invalid$/);
    // The anonymous application and the position it filled stay for the statistics.
    expect(await test.prisma.application.count({ where: { status: 'DEPLOYED' } })).toBe(1);
    expect((await test.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).hiredCount).toBe(1);

    const entry = await test.prisma.auditLog.findFirstOrThrow({
      where: { action: 'candidate.retention_delete' },
    });
    expect(entry).toMatchObject({
      actorId: null,
      entityId: candidate.profileId,
      before: { documents: 2, applications: 1 },
      after: { deletedBy: 'system' },
    });
    expect(JSON.stringify(entry)).not.toMatch(/amira|khelifi|FAKE1234567/i);
    // Nothing left to do at the next run.
    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 0 });
  });

  it('keeps the account of somebody who signs in after the warning', async () => {
    await lastSeen(ago(RETENTION_MONTHS, 5));
    await retention.run();
    expect((await user()).retentionWarnedAt).not.toBeNull();

    // The candidate follows the link of the email.
    test.clock.reset();
    await login(test, candidate.email);
    test.clock.set(new Date(Date.now() + (RETENTION_NOTICE_DAYS + 1) * DAY));
    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 0 });
    const kept = await user();
    expect(kept.deletedAt).toBeNull();
    expect(kept.retentionWarnedAt).toBeNull();
    expect(test.privateFiles.size).toBe(2);
  });

  it('never touches a candidate whose recruitment is in progress, nor back-office accounts', async () => {
    const job = await insertJob(test, catalog, { slug: 'welder' });
    test.clock.reset();
    await applyTo(test, candidate, job.id);
    const recruiter = await createUser(test, 'RECRUITER');
    test.clock.set(NOW);
    const longAgo = ago(RETENTION_MONTHS + 12);
    await test.prisma.application.updateMany({ data: { updatedAt: longAgo } });
    await lastSeen(longAgo);
    await lastSeen(longAgo, recruiter.id);
    test.outbox.length = 0;

    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 0 });
    test.clock.set(new Date(NOW.getTime() + 60 * DAY));
    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 0 });
    expect(test.outbox).toHaveLength(0);
    expect(await test.prisma.user.count({ where: { deletedAt: { not: null } } })).toBe(0);
  });

  it('counts a recent application as activity', async () => {
    const job = await insertJob(test, catalog, { slug: 'welder' });
    test.clock.reset();
    const id = await applyTo(test, candidate, job.id);
    await as(test, candidate).post(`/me/applications/${id}/withdraw`).expect(200);
    test.clock.set(NOW);
    await lastSeen(ago(RETENTION_MONTHS + 6));
    test.outbox.length = 0;
    // No sign-in for a long time, but an application withdrawn recently.
    expect(await retention.run()).toEqual({ ran: true, warned: 0, erased: 0 });
  });

  it('removes the messages of the contact form after two years, and says how many in the audit log', async () => {
    const message = (createdAt: Date, name: string) =>
      test.prisma.contactMessage.create({
        data: { name, email: `${name.toLowerCase()}@example.test`, message: 'Hello', createdAt },
      });
    await message(ago(RETENTION_MONTHS, 1), 'Old');
    await message(ago(RETENTION_MONTHS, -1), 'Recent');

    const report = await test.app.get(TasksService).run('retention');
    expect(report).toMatchObject({ ok: true, result: { contactMessages: 1 } });
    expect((await test.prisma.contactMessage.findMany()).map((row) => row.name)).toEqual([
      'Recent',
    ]);
    const entries = await test.prisma.auditLog.findMany({
      where: { action: 'contact_message.retention_delete' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: null, before: { messages: 1 } });
    expect(JSON.stringify(entries)).not.toContain('old@example.test');

    // Nothing to remove, nothing to write.
    expect(await retention.purgeContactMessages()).toBe(0);
    expect(await test.prisma.auditLog.count()).toBe(1);
  });

  it('runs as a scheduled task', async () => {
    await lastSeen(ago(RETENTION_MONTHS, 5));
    const report = await test.app.get(TasksService).run('retention');
    expect(report).toMatchObject({ ok: true, ran: true, result: { warned: 1, erased: 0 } });
  });
});
