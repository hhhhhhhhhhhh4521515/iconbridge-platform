import { publicJobSchema, publicStatsSchema } from '@iconbridge/shared';
import { CatalogService } from '../../src/catalog/catalog.service.js';
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

describe('public jobs (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;

  const list = async (query = '') => {
    const response = await test.http().get(`${API}/jobs${query}`).expect(200);
    return response.body as {
      items: { slug: string }[];
      total: number;
      page: number;
      pageSize: number;
    };
  };
  const slugs = async (query = '') => (await list(query)).items.map((job) => job.slug);

  beforeAll(async () => {
    test = await createTestApp();
    await resetDatabase(test.prisma);
    catalog = await seedCatalog(test);

    // Open jobs
    await insertJob(test, catalog, {
      slug: 'welder-poland',
      title: 'MIG/MAG Welder',
      description: 'Weld steel structures in a modern workshop near Gdansk.',
      destination: 'POLAND',
      category: 'construction',
      salary: [6000, 8000, 'PLN'],
      languages: ['en', 'pl'],
      publishedAt: daysFromNow(-5),
      deadline: daysFromNow(10),
    });
    await insertJob(test, catalog, {
      slug: 'receptionist-malta',
      title: 'Hotel Receptionist',
      description: 'Welcome guests at the front desk of a seaside hotel.',
      destination: 'MALTA',
      category: 'hospitality',
      salary: [1100, 1400, 'EUR'],
      languages: ['en'],
      featured: true,
      publishedAt: daysFromNow(-1),
      deadline: daysFromNow(40),
      employerName: 'Hidden Hotels Ltd',
    });
    await insertJob(test, catalog, {
      slug: 'cook-malta',
      title: 'Line Cook',
      description: 'Prepare dishes in a busy kitchen. Welding experience is not needed.',
      destination: 'MALTA',
      category: 'hospitality',
      salary: [1200, 1500, 'EUR'],
      languages: ['en', 'fr'],
      publishedAt: daysFromNow(-3),
      deadline: daysFromNow(20),
      employerName: 'Open Kitchen Ltd',
      showEmployerName: true,
    });
    await insertJob(test, catalog, {
      slug: 'driver-poland',
      title: 'Truck Driver',
      description: 'International routes with a modern fleet.',
      destination: 'POLAND',
      category: 'transport',
      publishedAt: daysFromNow(-2),
      deadline: daysFromNow(30),
    });
    await insertJob(test, catalog, {
      slug: 'steward-cruise',
      title: 'Cabin Steward',
      description: 'Keep guest cabins spotless on board.',
      destination: 'CRUISE_SHIP',
      category: 'hospitality',
      salary: [1300, 1700, 'USD'],
      languages: ['en'],
      publishedAt: daysFromNow(-4),
      deadline: daysFromNow(5),
    });

    // Never public
    await insertJob(test, catalog, {
      slug: 'hidden-draft',
      title: 'Welder Draft',
      status: 'DRAFT',
    });
    await insertJob(test, catalog, {
      slug: 'hidden-closed',
      title: 'Welder Closed',
      status: 'CLOSED',
    });
    await insertJob(test, catalog, {
      slug: 'hidden-archived',
      title: 'Welder Archived',
      status: 'ARCHIVED',
    });
    await insertJob(test, catalog, {
      slug: 'hidden-deleted',
      title: 'Welder Deleted',
      deletedAt: new Date(),
    });
    await insertJob(test, catalog, {
      slug: 'hidden-expired',
      title: 'Welder Expired',
      deadline: daysFromNow(-1),
    });
    await insertJob(test, catalog, {
      slug: 'hidden-full',
      title: 'Welder Full',
      positions: 2,
      hiredCount: 2,
    });
  });
  afterAll(async () => {
    await test.close();
  });

  const OPEN = [
    'cook-malta',
    'driver-poland',
    'receptionist-malta',
    'steward-cruise',
    'welder-poland',
  ];

  describe('visibility', () => {
    it('lists only published, live, unexpired jobs with positions left, without a session', async () => {
      const page = await list();
      expect(page.total).toBe(5);
      expect(page.items.map((job) => job.slug).sort()).toEqual(OPEN);
    });

    it.each([
      'hidden-draft',
      'hidden-closed',
      'hidden-archived',
      'hidden-deleted',
      'hidden-expired',
      'hidden-full',
    ])('answers 404 for %s, like for an unknown slug', async (slug) => {
      const hidden = await test.http().get(`${API}/jobs/${slug}`).expect(404);
      const unknown = await test.http().get(`${API}/jobs/no-such-job`).expect(404);
      expect(hidden.body).toEqual(unknown.body);
      expect(hidden.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('never returns a hidden job from a search that matches its title', async () => {
      expect((await slugs('?q=welder')).filter((slug) => slug.startsWith('hidden'))).toEqual([]);
      expect(await slugs('?q=Welder%20Draft')).not.toContain('hidden-draft');
    });

    it('hides a job the moment its deadline passes, before any scheduled task runs', async () => {
      await test.prisma.job.update({
        where: { slug: 'driver-poland' },
        data: { deadline: new Date(Date.now() - 1000) },
      });
      expect(await slugs()).not.toContain('driver-poland');
      await test.http().get(`${API}/jobs/driver-poland`).expect(404);
      expect(
        (await test.prisma.job.findUniqueOrThrow({ where: { slug: 'driver-poland' } })).status,
      ).toBe('PUBLISHED');
      await test.prisma.job.update({
        where: { slug: 'driver-poland' },
        data: { deadline: daysFromNow(30) },
      });
    });
  });

  describe('job detail', () => {
    it('returns the job with its destination and category, and no internal field', async () => {
      const response = await test.http().get(`${API}/jobs/welder-poland`).expect(200);
      const job = publicJobSchema.parse(response.body);
      expect(job).toMatchObject({
        slug: 'welder-poland',
        title: 'MIG/MAG Welder',
        destination: { code: 'POLAND', name: { en: 'Poland' } },
        category: { slug: 'construction' },
        salaryMin: 6000,
        salaryMax: 8000,
        salaryCurrency: 'PLN',
        salaryPeriod: 'MONTH',
        requiredLanguages: ['en', 'pl'],
        coverImageUrl: null,
      });
      for (const internal of [
        'hiredCount',
        'createdById',
        'status',
        'deletedAt',
        'showEmployerName',
        'searchVector',
      ]) {
        expect(response.body).not.toHaveProperty(internal);
      }
    });

    it('hides the employer name unless the employer agreed to show it', async () => {
      const hidden = await test.http().get(`${API}/jobs/receptionist-malta`).expect(200);
      expect((hidden.body as { employerName: unknown }).employerName).toBeNull();
      expect(JSON.stringify((await list()).items)).not.toContain('Hidden Hotels');
      const shown = await test.http().get(`${API}/jobs/cook-malta`).expect(200);
      expect((shown.body as { employerName: unknown }).employerName).toBe('Open Kitchen Ltd');
    });

    it('accepts the slug in any letter case', async () => {
      await test.http().get(`${API}/jobs/Welder-Poland`).expect(200);
    });
  });

  describe('filters', () => {
    it.each([
      ['destination', '?destination=MALTA', ['cook-malta', 'receptionist-malta']],
      ['destination in lower case', '?destination=poland', ['driver-poland', 'welder-poland']],
      ['unknown destination', '?destination=FRANCE', []],
      ['category', '?category=hospitality', ['cook-malta', 'receptionist-malta', 'steward-cruise']],
      ['destination and category', '?destination=POLAND&category=transport', ['driver-poland']],
      ['language', '?language=fr', ['cook-malta']],
      ['language shared by several', '?language=pl', ['welder-poland']],
      ['featured', '?featured=true', ['receptionist-malta']],
      [
        'not featured',
        '?featured=false',
        ['cook-malta', 'driver-poland', 'steward-cruise', 'welder-poland'],
      ],
      ['minimum salary in a currency', '?salaryMin=1450&currency=EUR', ['cook-malta']],
      ['maximum salary in a currency', '?salaryMax=1150&currency=EUR', ['receptionist-malta']],
      [
        'salary range in a currency',
        '?salaryMin=1000&salaryMax=2000&currency=USD',
        ['steward-cruise'],
      ],
      ['currency alone', '?currency=PLN', ['welder-poland']],
      [
        'salary filter leaves out jobs without a salary',
        '?salaryMin=1',
        ['cook-malta', 'receptionist-malta', 'steward-cruise', 'welder-poland'],
      ],
    ])('%s', async (_name, query, expected) => {
      expect((await slugs(query)).sort()).toEqual(expected);
    });

    it.each([
      '?salaryMin=2000&salaryMax=1000',
      '?featured=yes',
      '?sort=random',
      '?sort=relevance',
      '?q=a',
      '?page=0',
      '?pageSize=101',
      '?language=english',
    ])('answers 400 for %s', async (query) => {
      const response = await test.http().get(`${API}/jobs${query}`).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('search', () => {
    it('finds a word of the title', async () => {
      expect(await slugs('?q=receptionist')).toEqual(['receptionist-malta']);
    });

    it('finds a word of the description', async () => {
      expect(await slugs('?q=Gdansk')).toEqual(['welder-poland']);
      expect(await slugs('?q=cabins')).toEqual(['steward-cruise']);
    });

    it('finds "welder" when asked for the plural "welders"', async () => {
      expect(await slugs('?q=welders')).toEqual(['welder-poland']);
    });

    it.each([
      ['reciptionist', 'receptionist-malta'],
      ['recepcionist', 'receptionist-malta'],
      ['stewart', 'steward-cruise'],
      ['WELDER', 'welder-poland'],
    ])('tolerates the typo or case "%s"', async (text, expected) => {
      expect(await slugs(`?q=${text}`)).toContain(expected);
    });

    it('ranks a title match above a description match', async () => {
      // "welding" is in the description of the cook job; "Welder" is the title of the welder job.
      const found = await slugs('?q=welding');
      expect(found).toContain('cook-malta');
      const both = await slugs('?q=welder');
      expect(both[0]).toBe('welder-poland');
    });

    it('matches the beginning of a word, in the title and in the description', async () => {
      expect(await slugs('?q=recep')).toEqual(['receptionist-malta']);
      expect(await slugs('?q=guest')).toEqual(
        expect.arrayContaining(['receptionist-malta', 'steward-cruise']),
      );
      expect(await slugs('?q=Gdan')).toEqual(['welder-poland']);
    });

    it('requires every word of a multi-word search, in the title or the description', async () => {
      expect(await slugs('?q=hotel%20guests')).toEqual(['receptionist-malta']);
      expect(await slugs('?q=hotel%20welder')).toEqual([]);
    });

    it('combines search with filters', async () => {
      expect(await slugs('?q=guest&destination=MALTA')).toEqual(['receptionist-malta']);
      expect(await slugs('?q=welders&destination=MALTA')).toEqual([]);
    });

    it('returns nothing for a text that matches no job', async () => {
      expect(await list('?q=astronaut')).toMatchObject({ items: [], total: 0 });
    });

    it('treats quotes, operators and SQL as plain text', async () => {
      for (const text of ["'; DROP TABLE jobs; --", '" OR 1=1', 'a & | ! ( )', '%_%']) {
        const response = await test.http().get(`${API}/jobs`).query({ q: text });
        expect(response.status).toBe(200);
      }
      expect(await test.prisma.job.count()).toBe(11);
    });
  });

  describe('sorting and pagination', () => {
    it('sorts by newest publication by default', async () => {
      expect(await slugs()).toEqual([
        'receptionist-malta',
        'driver-poland',
        'cook-malta',
        'steward-cruise',
        'welder-poland',
      ]);
    });

    it('sorts by closest deadline', async () => {
      expect(await slugs('?sort=deadline')).toEqual([
        'steward-cruise',
        'welder-poland',
        'cook-malta',
        'driver-poland',
        'receptionist-malta',
      ]);
    });

    it('sorts by highest salary within a currency, jobs without salary last', async () => {
      expect(await slugs('?sort=salary&currency=EUR')).toEqual([
        'cook-malta',
        'receptionist-malta',
      ]);
      expect((await slugs('?sort=salary')).at(-1)).toBe('driver-poland');
    });

    it('pages through the results without gaps or repeats', async () => {
      const first = await list('?pageSize=2&page=1');
      const second = await list('?pageSize=2&page=2');
      const third = await list('?pageSize=2&page=3');
      const fourth = await list('?pageSize=2&page=4');
      expect([first.total, second.total, third.total, fourth.total]).toEqual([5, 5, 5, 5]);
      expect([
        first.items.length,
        second.items.length,
        third.items.length,
        fourth.items.length,
      ]).toEqual([2, 2, 1, 0]);
      const all = [...first.items, ...second.items, ...third.items].map((job) => job.slug);
      expect(new Set(all).size).toBe(5);
      expect(first).toMatchObject({ page: 1, pageSize: 2 });
    });
  });

  describe('destinations, categories and stats', () => {
    it('lists active destinations in order with their number of open jobs', async () => {
      const response = await test.http().get(`${API}/destinations`).expect(200);
      expect(
        (response.body as { code: string; openJobs: number }[]).map((d) => [d.code, d.openJobs]),
      ).toEqual([
        ['MALTA', 2],
        ['POLAND', 2],
        ['CRUISE_SHIP', 1],
      ]);
    });

    it('lists active categories with their number of open jobs', async () => {
      const response = await test.http().get(`${API}/categories`).expect(200);
      expect(
        (response.body as { slug: string; openJobs: number }[]).map((c) => [c.slug, c.openJobs]),
      ).toEqual([
        ['construction', 1],
        ['hospitality', 3],
        ['transport', 1],
      ]);
    });

    it('leaves inactive destinations and categories out', async () => {
      await test.prisma.destination.update({
        where: { code: 'CRUISE_SHIP' },
        data: { isActive: false },
      });
      await test.prisma.jobCategory.update({
        where: { slug: 'transport' },
        data: { isActive: false },
      });
      const destinations = (await test.http().get(`${API}/destinations`).expect(200)).body as {
        code: string;
      }[];
      const categories = (await test.http().get(`${API}/categories`).expect(200)).body as {
        slug: string;
      }[];
      expect(destinations.map((d) => d.code)).toEqual(['MALTA', 'POLAND']);
      expect(categories.map((c) => c.slug)).toEqual(['construction', 'hospitality']);
      await test.prisma.destination.update({
        where: { code: 'CRUISE_SHIP' },
        data: { isActive: true },
      });
      await test.prisma.jobCategory.update({
        where: { slug: 'transport' },
        data: { isActive: true },
      });
    });

    it('returns the home-page counters and caches them for 10 minutes', async () => {
      const service = test.app.get(CatalogService);
      service.clearStatsCache();
      await test.prisma.user.create({ data: { email: 'c1@example.test', role: 'CANDIDATE' } });
      await test.prisma.user.create({
        data: { email: 'c2@example.test', role: 'CANDIDATE', deletedAt: new Date() },
      });

      const first = await test.http().get(`${API}/stats`).expect(200);
      expect(first.headers['cache-control']).toBe('public, max-age=600');
      expect(publicStatsSchema.parse(first.body)).toEqual({
        openJobs: 5,
        registeredCandidates: 1,
        partnerCompanies: 0,
        visasApproved: 0,
        countries: 3,
      });

      // A change is not visible while the cached value is fresh...
      await test.prisma.user.create({ data: { email: 'c3@example.test', role: 'CANDIDATE' } });
      const cached = await test.http().get(`${API}/stats`).expect(200);
      expect(cached.body).toEqual(first.body);
      expect(await service.publicStats(Date.now() + 9 * 60_000)).toMatchObject({
        registeredCandidates: 1,
      });
      // ...and is after 10 minutes.
      expect(await service.publicStats(Date.now() + 10 * 60_000 + 1)).toMatchObject({
        registeredCandidates: 2,
      });
    });

    it('counts approved visas from applications that reached VISA_APPROVED or DEPLOYED', async () => {
      const service = test.app.get(CatalogService);
      const job = await test.prisma.job.findUniqueOrThrow({ where: { slug: 'welder-poland' } });
      for (const [index, status] of (
        ['SUBMITTED', 'VISA_PROCESSING', 'VISA_APPROVED', 'DEPLOYED', 'REJECTED'] as const
      ).entries()) {
        const user = await test.prisma.user.create({
          data: {
            email: `visa${index}@example.test`,
            role: 'CANDIDATE',
            candidateProfile: { create: { firstName: 'V', lastName: String(index) } },
          },
          include: { candidateProfile: true },
        });
        await test.prisma.application.create({
          data: {
            jobId: job.id,
            candidateId: user.candidateProfile?.id ?? '',
            status,
            profileSnapshot: {},
          },
        });
      }
      service.clearStatsCache();
      expect((await service.publicStats()).visasApproved).toBe(2);
    });
  });
});
