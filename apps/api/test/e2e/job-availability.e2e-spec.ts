import { SchedulerRegistry } from '@nestjs/schedule';
import { JobAvailabilityService } from '../../src/jobs/job-availability.service.js';
import {
  API,
  createTestApp,
  daysFromNow,
  insertJob,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type TestApp,
} from './app.js';

describe('automatic closing of jobs (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let service: JobAvailabilityService;

  beforeAll(async () => {
    test = await createTestApp();
    service = test.app.get(JobAvailabilityService);
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    catalog = await seedCatalog(test);
  });

  const statusOf = async (slug: string) =>
    (await test.prisma.job.findUniqueOrThrow({ where: { slug } })).status;

  it('closes published jobs whose deadline passed or whose positions are filled, and only those', async () => {
    await insertJob(test, catalog, { slug: 'expired', deadline: daysFromNow(-1) });
    await insertJob(test, catalog, { slug: 'just-expired', deadline: new Date(Date.now() - 1000) });
    await insertJob(test, catalog, { slug: 'full', positions: 3, hiredCount: 3 });
    await insertJob(test, catalog, {
      slug: 'open',
      deadline: daysFromNow(10),
      positions: 3,
      hiredCount: 2,
    });
    await insertJob(test, catalog, {
      slug: 'draft-expired',
      status: 'DRAFT',
      deadline: daysFromNow(-1),
    });
    await insertJob(test, catalog, {
      slug: 'archived-expired',
      status: 'ARCHIVED',
      deadline: daysFromNow(-1),
    });
    await insertJob(test, catalog, {
      slug: 'deleted-expired',
      deadline: daysFromNow(-1),
      deletedAt: new Date(),
    });

    const run = await service.closeUnavailableJobs();

    expect(run.ran).toBe(true);
    expect(run.closed.map((job) => [job.slug, job.reason]).sort()).toEqual([
      ['expired', 'deadline_passed'],
      ['full', 'positions_filled'],
      ['just-expired', 'deadline_passed'],
    ]);
    expect(await statusOf('expired')).toBe('CLOSED');
    expect(await statusOf('full')).toBe('CLOSED');
    expect(await statusOf('open')).toBe('PUBLISHED');
    expect(await statusOf('draft-expired')).toBe('DRAFT');
    expect(await statusOf('archived-expired')).toBe('ARCHIVED');
    expect(await statusOf('deleted-expired')).toBe('PUBLISHED');
    const closed = await test.prisma.job.findUniqueOrThrow({ where: { slug: 'expired' } });
    expect(closed.closedAt).toBeInstanceOf(Date);
  });

  it('logs each job it closed and writes a system audit entry', async () => {
    const job = await insertJob(test, catalog, { slug: 'expired', deadline: daysFromNow(-1) });
    const lines: string[] = [];
    const log = vi.spyOn(service['logger'], 'log').mockImplementation((message: unknown) => {
      lines.push(String(message));
    });

    await service.closeUnavailableJobs();
    log.mockRestore();

    expect(lines).toContain(`Closed job expired (${job.id}): deadline_passed`);
    expect(lines).toContain('Close unavailable jobs: 1 closed');
    const entries = await test.prisma.auditLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: null,
      action: 'job.auto_close',
      entityType: 'job',
      entityId: job.id,
      before: { status: 'PUBLISHED' },
      after: { status: 'CLOSED', reason: 'deadline_passed' },
    });
  });

  it('does nothing on a second run', async () => {
    await insertJob(test, catalog, { slug: 'expired', deadline: daysFromNow(-1) });
    expect((await service.closeUnavailableJobs()).closed).toHaveLength(1);
    expect(await service.closeUnavailableJobs()).toEqual({ ran: true, closed: [] });
    expect(await test.prisma.auditLog.count()).toBe(1);
  });

  it('several replicas at once: each job is closed and logged exactly once', async () => {
    for (let i = 0; i < 5; i++) {
      await insertJob(test, catalog, { slug: `expired-${i}`, deadline: daysFromNow(-1) });
    }
    const runs = await Promise.all(Array.from({ length: 6 }, () => service.closeUnavailableJobs()));
    const closedSlugs = runs.flatMap((run) => run.closed.map((job) => job.slug));
    expect(closedSlugs.sort()).toEqual([
      'expired-0',
      'expired-1',
      'expired-2',
      'expired-3',
      'expired-4',
    ]);
    expect(await test.prisma.auditLog.count()).toBe(5);
    expect(await test.prisma.job.count({ where: { status: 'CLOSED' } })).toBe(5);
  });

  it('skips its turn while another instance holds the lock', async () => {
    await insertJob(test, catalog, { slug: 'expired', deadline: daysFromNow(-1) });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Another replica in the middle of its run.
    const other = test.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(482210001)) AS l`;
      locked();
      await held;
    });

    await lockTaken;
    expect(await service.closeUnavailableJobs()).toEqual({ ran: false, closed: [] });
    expect(await statusOf('expired')).toBe('PUBLISHED');

    release();
    await other;
    expect((await service.closeUnavailableJobs()).closed).toHaveLength(1);
  });

  it('a job closed automatically answers 404 publicly and can be reopened after fixing the deadline', async () => {
    const job = await insertJob(test, catalog, { slug: 'expired', deadline: daysFromNow(-1) });
    await test.http().get(`${API}/jobs/expired`).expect(404);
    await service.closeUnavailableJobs();
    await test.http().get(`${API}/jobs/expired`).expect(404);
    await test.prisma.job.update({
      where: { id: job.id },
      data: { deadline: daysFromNow(10), status: 'PUBLISHED', closedAt: null },
    });
    await test.http().get(`${API}/jobs/expired`).expect(200);
  });

  it('is part of the scheduled tasks, which run every 15 minutes', () => {
    const job = test.app.get(SchedulerRegistry).getCronJob('scheduled-tasks');
    expect(String(job.cronTime.source)).toBe('0 */15 * * * *');
  });
});
