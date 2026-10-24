import { UTCDate } from '@date-fns/utc';
import { addMonths } from 'date-fns/addMonths';
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
  type ReadyCandidate,
  type TestApp,
  type TestUser,
} from './app.js';
import { applyTo, as } from './back-office.js';

const REASON = 'Rejected by mistake, confirmed by the employer';

/** SPEC section 6, rule 7: a super admin lifts the waiting period of one finished application. */
describe('lifting the re-application waiting period (e2e)', () => {
  let test: TestApp;
  let viewer: TestUser;
  let recruiter: TestUser;
  let superAdmin: TestUser;
  let candidate: ReadyCandidate;
  let jobId: string;

  const appliedAt = new Date('2026-03-12T09:30:00.000Z');
  const sixMonths = new Date('2026-09-12T09:30:00.000Z');

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.clock.reset();
    test.outbox.length = 0;
    test.privateFiles.clear();
    const catalog = await seedCatalog(test);
    viewer = await createUser(test, 'VIEWER');
    recruiter = await createUser(test, 'RECRUITER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');
    candidate = await createReadyCandidate(test, 'e2e-waiver@example.test');
    // Deadline far ahead: the clock moves by months.
    jobId = (
      await insertJob(test, catalog, {
        slug: 'housekeeper',
        title: 'Housekeeper',
        deadline: daysFromNow(900),
      })
    ).id;
  });

  /** The candidate applies at `appliedAt`; the recruiter rejects the application. */
  const rejectedApplication = async () => {
    test.clock.set(appliedAt);
    const id = await applyTo(test, candidate, jobId);
    await as(test, recruiter)
      .patch(`/admin/applications/${id}/status`, { status: 'REJECTED' })
      .expect(200);
    return id;
  };
  const waive = (id: string, user: TestUser = superAdmin, reason = REASON) =>
    as(test, user).post(`/admin/applications/${id}/waive-cooldown`, { reason });
  const eligibility = async () =>
    (
      await test
        .http()
        .get(`${API}/jobs/${jobId}/eligibility`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .expect(200)
    ).body as { canApply: boolean; reasons: string[]; nextAllowedAt: string | null };

  it('lets a super admin lift it: the candidate may apply again at once', async () => {
    const id = await rejectedApplication();
    test.clock.set(addMonths(new UTCDate(appliedAt), 1));
    expect(await eligibility()).toMatchObject({ canApply: false, reasons: ['REAPPLY_COOLDOWN'] });

    const response = await waive(id).expect(200);
    expect((response.body as { cooldownWaivedAt: string }).cooldownWaivedAt).toBe(
      test.clock.now().toISOString(),
    );
    expect(await eligibility()).toMatchObject({ canApply: true, reasons: [] });
    expect(await applyTo(test, candidate, jobId)).not.toBe(id);
  });

  it('starts a new waiting period with the next application', async () => {
    const id = await rejectedApplication();
    const waivedAt = addMonths(new UTCDate(appliedAt), 2);
    test.clock.set(waivedAt);
    await waive(id).expect(200);
    await applyTo(test, candidate, jobId);

    const after = await eligibility();
    expect(after.reasons).toContain('REAPPLY_COOLDOWN');
    expect(after.nextAllowedAt).toBe(addMonths(new UTCDate(waivedAt), 6).toISOString());
  });

  it('is allowed one millisecond before the end of the period, refused at the exact end', async () => {
    const id = await rejectedApplication();

    test.clock.set(sixMonths);
    const over = await waive(id).expect(409);
    expect(over.body).toMatchObject({ code: 'COOLDOWN_WAIVER_NOT_ALLOWED' });

    test.clock.set(new Date(sixMonths.getTime() - 1));
    await waive(id).expect(200);
  });

  it('refuses an application in progress, a second lift, and an unknown application', async () => {
    test.clock.set(appliedAt);
    const id = await applyTo(test, candidate, jobId);
    const inProgress = await waive(id).expect(409);
    expect(inProgress.body).toMatchObject({ code: 'COOLDOWN_WAIVER_NOT_ALLOWED' });

    await as(test, recruiter)
      .patch(`/admin/applications/${id}/status`, { status: 'REJECTED' })
      .expect(200);
    await waive(id).expect(200);
    const twice = await waive(id).expect(409);
    expect(twice.body).toMatchObject({ code: 'COOLDOWN_WAIVER_NOT_ALLOWED' });

    await waive('00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('needs a reason of 5 characters or more', async () => {
    const id = await rejectedApplication();
    const response = await waive(id, superAdmin, '  ok ').expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(
      (await test.prisma.application.findUniqueOrThrow({ where: { id } })).cooldownWaivedAt,
    ).toBeNull();
  });

  it('is refused to recruiters, viewers, candidates and visitors', async () => {
    const id = await rejectedApplication();
    await waive(id, recruiter).expect(403);
    await waive(id, viewer).expect(403);
    await as(test, candidate)
      .post(`/admin/applications/${id}/waive-cooldown`, { reason: REASON })
      .expect(403);
    await test
      .http()
      .post(`${API}/admin/applications/${id}/waive-cooldown`)
      .send({ reason: REASON })
      .expect(401);
    expect(
      (await test.prisma.application.findUniqueOrThrow({ where: { id } })).cooldownWaivedAt,
    ).toBeNull();
    expect(await eligibility()).toMatchObject({ canApply: false });
  });

  it('writes one audit entry with the reason, and tells the candidate nothing', async () => {
    const id = await rejectedApplication();
    test.outbox.length = 0;
    await waive(id).expect(200);

    const entries = await test.prisma.auditLog.findMany({
      where: { action: 'application.waive_cooldown' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: superAdmin.id,
      entityType: 'application',
      entityId: id,
      before: { status: 'REJECTED', cooldownWaivedAt: null },
      after: { status: 'REJECTED', reason: REASON },
    });
    expect(test.outbox).toHaveLength(0);
    const mine = await as(test, candidate).get('/me/applications').expect(200);
    expect(JSON.stringify(mine.body)).not.toContain(REASON);
    expect(JSON.stringify(mine.body)).not.toContain('cooldownWaived');
  });
});
