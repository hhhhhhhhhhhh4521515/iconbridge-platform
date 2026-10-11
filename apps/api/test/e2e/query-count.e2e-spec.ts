import {
  API,
  createTestApp,
  createUser,
  insertJob,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type TestApp,
  type TestUser,
} from './app.js';
import { as, newApplication } from './back-office.js';

/**
 * No "N+1": a list makes the same number of SQL queries whether it returns 3 rows or
 * 24. A query per row would make the pages slower as the data grows.
 */
describe('number of queries of the list endpoints (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let viewer: TestUser;
  let superAdmin: TestUser;
  let jobId: string;
  let candidate: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    await resetDatabase(test.prisma);
    catalog = await seedCatalog(test);
    viewer = await createUser(test, 'VIEWER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');
  });
  afterAll(async () => {
    await test.close();
  });

  /** Adds jobs, candidates with one application each, stories and messages. */
  const grow = async (from: number, to: number) => {
    for (let index = from; index < to; index++) {
      const job = await insertJob(test, catalog, {
        slug: `job-${String(index)}`,
        title: `Welder ${String(index)}`,
        positions: 100,
      });
      jobId = job.id;
      ({ candidate } = await newApplication(test, job.id));
      const story = (
        await as(test, superAdmin)
          .post('/admin/success-stories', {
            firstName: `Name${String(index)}`,
            jobTitle: 'Welder',
            destinationId: catalog.destinations.MALTA,
            quote: { en: 'q', fr: 'q', ar: 'q' },
          })
          .expect(201)
      ).body as { id: string };
      await test.prisma.successStory.update({
        where: { id: story.id },
        data: { isPublished: true, consentDocumentPath: 'consent/x.pdf' },
      });
      await test.prisma.contactMessage.create({
        data: {
          name: `N${String(index)}`,
          email: 'a@example.test',
          message: 'Hello there, a question.',
        },
      });
    }
  };

  const queries = async (call: () => Promise<unknown>): Promise<number> => {
    const before = test.prisma.queryCount;
    await call();
    return test.prisma.queryCount - before;
  };

  const lists: [string, () => Promise<unknown>][] = [
    ['GET /jobs', () => test.http().get(`${API}/jobs?pageSize=50`).expect(200)],
    ['GET /destinations', () => test.http().get(`${API}/destinations`).expect(200)],
    ['GET /success-stories', () => test.http().get(`${API}/success-stories`).expect(200)],
    ['GET /admin/jobs', () => as(test, viewer).get('/admin/jobs?pageSize=50').expect(200)],
    [
      'GET /admin/applications',
      () => as(test, viewer).get('/admin/applications?pageSize=50').expect(200),
    ],
    [
      'GET /admin/candidates',
      () => as(test, viewer).get('/admin/candidates?pageSize=50').expect(200),
    ],
    [
      'GET /admin/contact-messages',
      () => as(test, viewer).get('/admin/contact-messages?pageSize=50').expect(200),
    ],
    ['GET /admin/stats', () => as(test, viewer).get('/admin/stats').expect(200)],
    [
      'GET /admin/audit-logs',
      () => as(test, superAdmin).get('/admin/audit-logs?pageSize=50').expect(200),
    ],
    [
      'GET /admin/success-stories',
      () => as(test, superAdmin).get('/admin/success-stories').expect(200),
    ],
    [
      'POST /admin/applications/export',
      () => as(test, superAdmin).post('/admin/applications/export', { format: 'csv' }).expect(200),
    ],
  ];

  it('stays the same when the lists grow from 3 rows to 24', async () => {
    await grow(0, 3);
    const small = new Map<string, number>();
    for (const [name, call] of lists) {
      small.set(name, await queries(call));
    }
    await grow(3, 24);
    const report: Record<string, [number, number]> = {};
    for (const [name, call] of lists) {
      report[name] = [small.get(name) ?? 0, await queries(call)];
    }
    for (const [name, [few, many]] of Object.entries(report)) {
      expect(
        many,
        `${name}: ${String(few)} queries for 3 rows, ${String(many)} for 24`,
      ).toBeLessThanOrEqual(few);
      // And a list is a handful of queries, not dozens.
      expect(many, name).toBeLessThanOrEqual(20);
    }
    expect(jobId).toBeDefined();
    expect(candidate.id).toBeDefined();
  });
});
