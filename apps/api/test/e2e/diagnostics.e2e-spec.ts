import {
  API,
  createTestApp,
  createUser,
  resetDatabase,
  type TestApp,
  type TestUser,
} from './app.js';
import { as } from './back-office.js';

// Checks of the monitoring: a super admin makes the API fail on purpose (docs/RUNBOOK.md).
describe('admin diagnostics (e2e)', () => {
  let test: TestApp;
  let superAdmin: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    superAdmin = await createUser(test, 'SUPER_ADMIN');
  });

  it('fails with 500 for a super admin, without details, and records who did it', async () => {
    const response = await as(test, superAdmin).post('/admin/diagnostics/error').expect(500);
    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    const entries = await test.prisma.auditLog.findMany({
      where: { action: 'diagnostics.forced_error' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: superAdmin.id, entityType: 'diagnostics' });
  });

  it('is refused to every other role, and to visitors', async () => {
    for (const role of ['VIEWER', 'RECRUITER', 'CANDIDATE'] as const) {
      const user = await createUser(test, role);
      await as(test, user).post('/admin/diagnostics/error').expect(403);
    }
    await test.http().post(`${API}/admin/diagnostics/error`).expect(401);
    expect(
      await test.prisma.auditLog.count({ where: { action: 'diagnostics.forced_error' } }),
    ).toBe(0);
  });
});
