import { adminJobSchema } from '@iconbridge/shared';
import sharp from 'sharp';
import {
  API,
  cookieHeader,
  createTestApp,
  createUser,
  daysFromNow,
  insertJob,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type TestApp,
  type TestUser,
} from './app.js';

const jpeg = (width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toBuffer();

describe('admin jobs (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let candidate: TestUser;
  let viewer: TestUser;
  let recruiter: TestUser;
  let superAdmin: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.files.clear();
    catalog = await seedCatalog(test);
    candidate = await createUser(test, 'CANDIDATE');
    viewer = await createUser(test, 'VIEWER');
    recruiter = await createUser(test, 'RECRUITER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');
  });

  const as = (user: TestUser) => {
    const cookie = cookieHeader(user.cookies);
    return {
      get: (path: string) => test.http().get(`${API}${path}`).set('Cookie', cookie),
      post: (path: string, body: object = {}) =>
        test.http().post(`${API}${path}`).set('Cookie', cookie).send(body),
      patch: (path: string, body: object = {}) =>
        test.http().patch(`${API}${path}`).set('Cookie', cookie).send(body),
      delete: (path: string) => test.http().delete(`${API}${path}`).set('Cookie', cookie),
      upload: (path: string, file: Buffer, name = 'cover.jpg') =>
        test.http().post(`${API}${path}`).set('Cookie', cookie).attach('file', file, name),
    };
  };

  const body = (overrides: object = {}) => ({
    title: 'Hotel Receptionist',
    destinationId: catalog.destinations.MALTA,
    categoryId: catalog.categories.hospitality,
    description: 'Welcome guests and manage reservations at the front desk.',
    deadline: daysFromNow(30).toISOString(),
    ...overrides,
  });

  const create = async (overrides: object = {}, user: TestUser = recruiter) => {
    const response = await as(user).post('/admin/jobs', body(overrides)).expect(201);
    return adminJobSchema.parse(response.body);
  };
  const publicStatus = async (slug: string) =>
    (await test.http().get(`${API}/jobs/${slug}`)).status;

  describe('create and slug', () => {
    it('creates a draft that is not public, owned by the author', async () => {
      const job = await create({
        salaryMin: 1100,
        salaryMax: 1400,
        salaryCurrency: 'eur',
        salaryPeriod: 'MONTH',
      });
      expect(job).toMatchObject({
        slug: 'hotel-receptionist-malta',
        status: 'DRAFT',
        featured: false,
        hiredCount: 0,
        applicationCount: 0,
        createdById: recruiter.id,
        salaryCurrency: 'EUR',
        publishedAt: null,
        destination: { code: 'MALTA' },
        category: { slug: 'hospitality' },
      });
      expect(await publicStatus(job.slug)).toBe(404);
    });

    it('makes slugs unique with a numeric suffix, also against deleted jobs', async () => {
      const first = await create();
      const second = await create();
      await as(recruiter).delete(`/admin/jobs/${second.id}`).expect(204);
      const third = await create();
      const poland = await create({ destinationId: catalog.destinations.POLAND });
      expect([first.slug, second.slug, third.slug, poland.slug]).toEqual([
        'hotel-receptionist-malta',
        'hotel-receptionist-malta-2',
        'hotel-receptionist-malta-3',
        'hotel-receptionist-poland',
      ]);
    });

    it('gives distinct slugs to jobs created at the same time', async () => {
      const responses = await Promise.all(
        [1, 2, 3, 4].map(() => as(recruiter).post('/admin/jobs', body())),
      );
      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
      const slugs = responses.map((response) => (response.body as { slug: string }).slug);
      expect(new Set(slugs).size).toBe(4);
    });

    it('cannot set the status, the slug, the featured mark or the hired count at creation', async () => {
      const job = await create({
        status: 'PUBLISHED',
        slug: 'chosen',
        featured: true,
        hiredCount: 3,
      });
      expect(job).toMatchObject({
        status: 'DRAFT',
        slug: 'hotel-receptionist-malta',
        featured: false,
        hiredCount: 0,
      });
    });

    it.each([
      ['a short title', { title: 'ab' }, 'title'],
      ['a salary without currency', { salaryMin: 1000 }, 'salaryCurrency'],
      [
        'an inverted salary range',
        { salaryMin: 2000, salaryMax: 1000, salaryCurrency: 'EUR', salaryPeriod: 'MONTH' },
        'salaryMax',
      ],
      ['zero positions', { positions: 0 }, 'positions'],
      [
        'an unknown destination',
        { destinationId: '00000000-0000-4000-8000-000000000000' },
        'destinationId',
      ],
      ['a malformed deadline', { deadline: 'next month' }, 'deadline'],
    ])('answers 400 for %s', async (_case, overrides, field) => {
      const response = await as(recruiter).post('/admin/jobs', body(overrides)).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(
        (response.body as { details: { path: string }[] }).details.map((issue) => issue.path),
      ).toContain(field);
      expect(await test.prisma.job.count()).toBe(0);
    });

    it('refuses an inactive destination or category for a new job', async () => {
      await test.prisma.destination.update({
        where: { id: catalog.destinations.MALTA },
        data: { isActive: false },
      });
      await as(recruiter).post('/admin/jobs', body()).expect(400);
    });
  });

  describe('update', () => {
    it('edits fields; the slug follows the title while the job was never published', async () => {
      const job = await create();
      const renamed = await as(recruiter)
        .patch(`/admin/jobs/${job.id}`, { title: 'Night Receptionist', positions: 3 })
        .expect(200);
      expect(renamed.body).toMatchObject({
        title: 'Night Receptionist',
        slug: 'night-receptionist-malta',
        positions: 3,
      });
      const moved = await as(recruiter)
        .patch(`/admin/jobs/${job.id}`, { destinationId: catalog.destinations.POLAND })
        .expect(200);
      expect(moved.body).toMatchObject({
        slug: 'night-receptionist-poland',
        destination: { code: 'POLAND' },
      });
    });

    it('keeps the slug of a job that has been published, so shared links keep working', async () => {
      const job = await create();
      await as(recruiter).post(`/admin/jobs/${job.id}/publish`).expect(200);
      const renamed = await as(recruiter)
        .patch(`/admin/jobs/${job.id}`, { title: 'Senior Receptionist' })
        .expect(200);
      expect(renamed.body).toMatchObject({
        title: 'Senior Receptionist',
        slug: 'hotel-receptionist-malta',
      });
      expect(await publicStatus('hotel-receptionist-malta')).toBe(200);
    });

    it('checks the salary rules on the merged job', async () => {
      const job = await create({
        salaryMin: 1000,
        salaryMax: 1400,
        salaryCurrency: 'EUR',
        salaryPeriod: 'MONTH',
      });
      const inverted = await as(recruiter)
        .patch(`/admin/jobs/${job.id}`, { salaryMin: 2000 })
        .expect(400);
      expect((inverted.body as { details: { path: string }[] }).details[0]?.path).toBe('salaryMax');
      await as(recruiter).patch(`/admin/jobs/${job.id}`, { salaryCurrency: null }).expect(400);
      await as(recruiter)
        .patch(`/admin/jobs/${job.id}`, {
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          salaryPeriod: null,
        })
        .expect(200);
    });

    it('refuses fewer positions than candidates already hired, and a past deadline on a published job', async () => {
      const job = await create({ positions: 5 });
      await as(recruiter).post(`/admin/jobs/${job.id}/publish`).expect(200);
      await test.prisma.job.update({ where: { id: job.id }, data: { hiredCount: 3 } });
      await as(recruiter).patch(`/admin/jobs/${job.id}`, { positions: 2 }).expect(400);
      await as(recruiter).patch(`/admin/jobs/${job.id}`, { positions: 4 }).expect(200);
      await as(recruiter)
        .patch(`/admin/jobs/${job.id}`, { deadline: daysFromNow(-1).toISOString() })
        .expect(400);
    });

    it('answers 400 for an empty body, 404 for an unknown or deleted job', async () => {
      const job = await create();
      await as(recruiter).patch(`/admin/jobs/${job.id}`, {}).expect(400);
      await as(recruiter).patch(`/admin/jobs/${job.id}`, { status: 'PUBLISHED' }).expect(400);
      await as(recruiter)
        .patch('/admin/jobs/00000000-0000-4000-8000-000000000000', { title: 'Other title' })
        .expect(404);
      await as(recruiter).delete(`/admin/jobs/${job.id}`).expect(204);
      await as(recruiter).patch(`/admin/jobs/${job.id}`, { title: 'Other title' }).expect(404);
    });
  });

  describe('status actions', () => {
    it('publish -> close -> reopen -> archive, with the public site following each step', async () => {
      const job = await create();
      const slug = job.slug;
      const act = async (action: string) =>
        (await as(recruiter).post(`/admin/jobs/${job.id}/${action}`).expect(200)).body as {
          status: string;
          publishedAt: string | null;
          closedAt: string | null;
        };

      const published = await act('publish');
      expect(published).toMatchObject({ status: 'PUBLISHED', closedAt: null });
      expect(published.publishedAt).not.toBeNull();
      expect(await publicStatus(slug)).toBe(200);

      const closed = await act('close');
      expect(closed.status).toBe('CLOSED');
      expect(closed.closedAt).not.toBeNull();
      expect(await publicStatus(slug)).toBe(404);

      const reopened = await act('reopen');
      expect(reopened).toMatchObject({
        status: 'PUBLISHED',
        closedAt: null,
        publishedAt: published.publishedAt,
      });
      expect(await publicStatus(slug)).toBe(200);

      const archived = await act('archive');
      expect(archived.status).toBe('ARCHIVED');
      expect(await publicStatus(slug)).toBe(404);
    });

    it.each([
      ['close', 'DRAFT'],
      ['reopen', 'DRAFT'],
      ['publish', 'PUBLISHED'],
      ['reopen', 'PUBLISHED'],
      ['publish', 'CLOSED'],
      ['close', 'CLOSED'],
      ['publish', 'ARCHIVED'],
      ['close', 'ARCHIVED'],
      ['reopen', 'ARCHIVED'],
      ['archive', 'ARCHIVED'],
    ] as const)('refuses to %s a %s job (409)', async (action, status) => {
      const job = await insertJob(test, catalog, { slug: 'state-job', status });
      const response = await as(recruiter).post(`/admin/jobs/${job.id}/${action}`).expect(409);
      expect(response.body).toMatchObject({
        code: 'INVALID_JOB_TRANSITION',
        details: { status, action },
      });
      expect((await test.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        status,
      );
    });

    it.each([
      ['the deadline has passed', { deadline: daysFromNow(-1) }],
      ['every position is filled', { positions: 2, hiredCount: 2 }],
    ])('refuses to publish or reopen when %s', async (_case, seed) => {
      const draft = await insertJob(test, catalog, { slug: 'draft-job', status: 'DRAFT', ...seed });
      const closed = await insertJob(test, catalog, {
        slug: 'closed-job',
        status: 'CLOSED',
        ...seed,
      });
      const publish = await as(recruiter).post(`/admin/jobs/${draft.id}/publish`).expect(409);
      expect(publish.body).toMatchObject({ code: 'JOB_NOT_PUBLISHABLE' });
      await as(recruiter).post(`/admin/jobs/${closed.id}/reopen`).expect(409);
    });

    it('refuses to publish in an inactive destination', async () => {
      const job = await create();
      await test.prisma.destination.update({
        where: { id: catalog.destinations.MALTA },
        data: { isActive: false },
      });
      await as(recruiter).post(`/admin/jobs/${job.id}/publish`).expect(409);
    });

    it('features and unfeatures a job', async () => {
      const job = await create();
      expect(
        (await as(recruiter).post(`/admin/jobs/${job.id}/feature`).expect(200)).body,
      ).toMatchObject({ featured: true });
      expect(
        (await as(recruiter).post(`/admin/jobs/${job.id}/unfeature`).expect(200)).body,
      ).toMatchObject({ featured: false });
    });

    it('duplicates a job into a new draft without its history', async () => {
      const source = await insertJob(test, catalog, {
        slug: 'source-job',
        title: 'Line Cook',
        featured: true,
        positions: 4,
        hiredCount: 2,
        salary: [1200, 1500, 'EUR'],
        languages: ['en'],
      });
      await test.prisma.job.update({
        where: { id: source.id },
        data: { coverImagePath: 'jobs/x/cover-1.webp' },
      });
      const response = await as(superAdmin).post(`/admin/jobs/${source.id}/duplicate`).expect(201);
      const copy = adminJobSchema.parse(response.body);
      expect(copy).toMatchObject({
        title: 'Line Cook (copy)',
        slug: 'line-cook-copy-malta',
        status: 'DRAFT',
        featured: false,
        hiredCount: 0,
        positions: 4,
        salaryMax: 1500,
        requiredLanguages: ['en'],
        coverImageUrl: null,
        publishedAt: null,
        createdById: superAdmin.id,
      });
      expect(copy.id).not.toBe(source.id);
    });
  });

  describe('delete', () => {
    it('soft-deletes by default: gone from the site and the list, kept in the database', async () => {
      const job = await create();
      await as(recruiter).post(`/admin/jobs/${job.id}/publish`).expect(200);
      await as(recruiter).delete(`/admin/jobs/${job.id}`).expect(204);

      expect(await publicStatus(job.slug)).toBe(404);
      const row = await test.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(row.deletedAt).toBeInstanceOf(Date);
      const live = (await as(recruiter).get('/admin/jobs').expect(200)).body as { total: number };
      const deleted = (await as(recruiter).get('/admin/jobs?deleted=true').expect(200)).body as {
        total: number;
        items: { id: string }[];
      };
      expect(live.total).toBe(0);
      expect(deleted.items.map((item) => item.id)).toEqual([job.id]);
      // Still readable one by one, and deleting again changes nothing.
      expect((await as(recruiter).get(`/admin/jobs/${job.id}`).expect(200)).body).toHaveProperty(
        'deletedAt',
      );
      await as(recruiter).delete(`/admin/jobs/${job.id}`).expect(204);
    });

    it('permanently deletes a job without applications', async () => {
      const job = await create();
      await as(recruiter).delete(`/admin/jobs/${job.id}?permanent=true`).expect(204);
      expect(await test.prisma.job.findUnique({ where: { id: job.id } })).toBeNull();
    });

    it('refuses a permanent delete when applications exist, and still allows the soft delete', async () => {
      const job = await create();
      await test.prisma.application.create({
        data: { jobId: job.id, candidateId: candidate.profileId ?? '', profileSnapshot: {} },
      });
      const refused = await as(superAdmin)
        .delete(`/admin/jobs/${job.id}?permanent=true`)
        .expect(409);
      expect(refused.body).toMatchObject({
        code: 'JOB_HAS_APPLICATIONS',
        details: { applications: 1 },
      });
      expect(await test.prisma.job.count()).toBe(1);
      expect(await test.prisma.application.count()).toBe(1);

      await as(superAdmin).delete(`/admin/jobs/${job.id}`).expect(204);
      expect(await test.prisma.application.count()).toBe(1);
    });
  });

  describe('cover image', () => {
    it('stores a resized WebP in the public media container and returns its URL', async () => {
      const job = await create();
      const response = await as(recruiter)
        .upload(`/admin/jobs/${job.id}/cover`, await jpeg(2400, 1350))
        .expect(200);
      const url = (response.body as { coverImageUrl: string }).coverImageUrl;
      expect(url).toMatch(
        new RegExp(`^https://media\\.example\\.test/jobs/${job.id}/cover-[0-9a-f]{16}\\.webp$`),
      );
      expect([...test.files.values()]).toEqual([
        expect.objectContaining({ contentType: 'image/webp' }),
      ]);

      await as(recruiter).post(`/admin/jobs/${job.id}/publish`).expect(200);
      const publicJob = await test.http().get(`${API}/jobs/${job.slug}`).expect(200);
      expect((publicJob.body as { coverImageUrl: string }).coverImageUrl).toBe(url);
    });

    it('replaces the previous file, and removes it on request', async () => {
      const job = await create();
      await as(recruiter)
        .upload(`/admin/jobs/${job.id}/cover`, await jpeg(1600, 900))
        .expect(200);
      const first = [...test.files.keys()];
      await as(recruiter)
        .upload(`/admin/jobs/${job.id}/cover`, await jpeg(1000, 1000))
        .expect(200);
      expect(test.files.size).toBe(1);
      expect([...test.files.keys()]).not.toEqual(first);

      const removed = await as(recruiter).delete(`/admin/jobs/${job.id}/cover`).expect(200);
      expect((removed.body as { coverImageUrl: unknown }).coverImageUrl).toBeNull();
      expect(test.files.size).toBe(0);
    });

    it('refuses a file that is not a JPEG, PNG or WebP image, whatever its name', async () => {
      const job = await create();
      const text = await as(recruiter)
        .upload(`/admin/jobs/${job.id}/cover`, Buffer.from('<?php echo 1; ?>'), 'cover.png')
        .expect(415);
      expect(text.body).toMatchObject({ code: 'UNSUPPORTED_FILE' });
      const gif = await sharp({
        create: { width: 10, height: 10, channels: 3, background: '#fff' },
      })
        .gif()
        .toBuffer();
      await as(recruiter).upload(`/admin/jobs/${job.id}/cover`, gif, 'cover.jpg').expect(415);
      expect(test.files.size).toBe(0);
    });

    it('refuses a missing file and a file above 5 MB', async () => {
      const job = await create();
      await as(recruiter).post(`/admin/jobs/${job.id}/cover`).expect(400);
      const tooBig = await as(recruiter).upload(
        `/admin/jobs/${job.id}/cover`,
        Buffer.alloc(5 * 1024 * 1024 + 10),
        'big.jpg',
      );
      expect(tooBig.status).toBe(413);
      expect(test.files.size).toBe(0);
    });
  });

  describe('list', () => {
    it('lists every status with filters, pagination and the application count', async () => {
      await insertJob(test, catalog, {
        slug: 'a-draft',
        title: 'Welder',
        status: 'DRAFT',
        destination: 'POLAND',
        category: 'construction',
      });
      const published = await insertJob(test, catalog, { slug: 'a-published', title: 'Cook' });
      await insertJob(test, catalog, { slug: 'a-closed', title: 'Cook Helper', status: 'CLOSED' });
      await insertJob(test, catalog, {
        slug: 'a-expired',
        title: 'Driver',
        deadline: daysFromNow(-2),
      });
      await test.prisma.application.create({
        data: { jobId: published.id, candidateId: candidate.profileId ?? '', profileSnapshot: {} },
      });

      type Page = {
        total: number;
        items: { slug: string; applicationCount: number; status: string }[];
      };
      const all = (await as(viewer).get('/admin/jobs').expect(200)).body as Page;
      expect(all.total).toBe(4);
      expect(all.items.find((job) => job.slug === 'a-published')?.applicationCount).toBe(1);

      const drafts = (await as(viewer).get('/admin/jobs?status=DRAFT').expect(200)).body as Page;
      expect(drafts.items.map((job) => job.slug)).toEqual(['a-draft']);
      const poland = (
        await as(viewer).get(`/admin/jobs?destinationId=${catalog.destinations.POLAND}`).expect(200)
      ).body as Page;
      expect(poland.items.map((job) => job.slug)).toEqual(['a-draft']);
      const cooks = (await as(viewer).get('/admin/jobs?q=cook').expect(200)).body as Page;
      expect(cooks.items.map((job) => job.slug).sort()).toEqual(['a-closed', 'a-published']);
      const paged = (await as(viewer).get('/admin/jobs?pageSize=3&page=2').expect(200))
        .body as Page;
      expect(paged.items).toHaveLength(1);
      await as(viewer).get('/admin/jobs?status=OPEN').expect(400);
    });
  });

  describe('permissions per role', () => {
    it('lets a viewer read jobs, destinations and categories', async () => {
      const job = await insertJob(test, catalog, { slug: 'readable' });
      await as(viewer).get('/admin/jobs').expect(200);
      await as(viewer).get(`/admin/jobs/${job.id}`).expect(200);
      await as(viewer).get('/admin/destinations').expect(200);
      await as(viewer).get('/admin/categories').expect(200);
    });

    it('refuses every job write to a viewer and to a candidate, and changes nothing', async () => {
      const job = await insertJob(test, catalog, { slug: 'protected', status: 'DRAFT' });
      const before = await test.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      for (const user of [viewer, candidate]) {
        const client = as(user);
        const statuses = [
          (await client.post('/admin/jobs', body())).status,
          (await client.patch(`/admin/jobs/${job.id}`, { title: 'Changed title' })).status,
          (await client.delete(`/admin/jobs/${job.id}`)).status,
          (await client.delete(`/admin/jobs/${job.id}?permanent=true`)).status,
          (await client.upload(`/admin/jobs/${job.id}/cover`, await jpeg(100, 100))).status,
          (await client.delete(`/admin/jobs/${job.id}/cover`)).status,
          (
            await client.post('/admin/destinations', {
              code: 'GERMANY',
              name: { en: 'G', fr: 'A', ar: 'أ' },
            })
          ).status,
          (
            await client.patch(`/admin/destinations/${catalog.destinations.MALTA}`, {
              isActive: false,
            })
          ).status,
          (await client.delete(`/admin/destinations/${catalog.destinations.MALTA}`)).status,
          (
            await client.post('/admin/categories', {
              slug: 'it',
              name: { en: 'IT', fr: 'IT', ar: 'IT' },
            })
          ).status,
          (await client.delete(`/admin/categories/${catalog.categories.transport}`)).status,
        ];
        for (const action of [
          'publish',
          'close',
          'reopen',
          'archive',
          'duplicate',
          'feature',
          'unfeature',
        ]) {
          statuses.push((await client.post(`/admin/jobs/${job.id}/${action}`)).status);
        }
        expect(new Set(statuses)).toEqual(new Set([403]));
      }
      expect(await test.prisma.job.count()).toBe(1);
      expect(await test.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toEqual(before);
      expect(await test.prisma.destination.count({ where: { isActive: true } })).toBe(3);
      expect(test.files.size).toBe(0);
    });

    it('refuses a candidate on job reads too, and anyone without a session', async () => {
      await as(candidate).get('/admin/jobs').expect(403);
      await as(candidate).get('/admin/destinations').expect(403);
      await test.http().get(`${API}/admin/jobs`).expect(401);
      await test.http().post(`${API}/admin/jobs`).send(body()).expect(401);
    });

    it('lets a recruiter and a super admin write', async () => {
      for (const user of [recruiter, superAdmin]) {
        const job = await create({ title: `Job of ${user.role}` }, user);
        await as(user).post(`/admin/jobs/${job.id}/publish`).expect(200);
        await as(user).delete(`/admin/jobs/${job.id}`).expect(204);
      }
    });
  });

  describe('destinations and categories', () => {
    const name = { en: 'Germany', fr: 'Allemagne', ar: 'ألمانيا' };

    it('creates, edits and lists destinations; the code is unique and cannot change', async () => {
      const created = await as(recruiter)
        .post('/admin/destinations', { code: 'germany', name, icon: '🇩🇪', sortOrder: 4 })
        .expect(201);
      const id = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({ code: 'GERMANY', isActive: true, jobCount: 0 });
      const duplicate = await as(recruiter)
        .post('/admin/destinations', { code: 'GERMANY', name })
        .expect(409);
      expect(duplicate.body).toMatchObject({ code: 'CONFLICT' });
      await as(recruiter)
        .post('/admin/destinations', { code: 'ITALY', name: { en: 'Italy' } })
        .expect(400);

      const edited = await as(recruiter)
        .patch(`/admin/destinations/${id}`, { sortOrder: 9, code: 'DE' })
        .expect(200);
      expect(edited.body).toMatchObject({ code: 'GERMANY', sortOrder: 9 });
      const listed = (await as(viewer).get('/admin/destinations').expect(200)).body as {
        code: string;
      }[];
      expect(listed.map((row) => row.code)).toEqual(['MALTA', 'POLAND', 'CRUISE_SHIP', 'GERMANY']);
      expect(
        ((await test.http().get(`${API}/destinations`).expect(200)).body as { code: string }[]).map(
          (d) => d.code,
        ),
      ).toContain('GERMANY');
    });

    it('deletes an unused destination, and only deactivates one that jobs use', async () => {
      await insertJob(test, catalog, { slug: 'uses-malta', destination: 'MALTA' });
      const unused = await as(recruiter)
        .delete(`/admin/destinations/${catalog.destinations.CRUISE_SHIP}`)
        .expect(200);
      expect(unused.body).toEqual({ outcome: 'deleted' });
      expect(
        await test.prisma.destination.findUnique({
          where: { id: catalog.destinations.CRUISE_SHIP },
        }),
      ).toBeNull();

      const used = await as(recruiter)
        .delete(`/admin/destinations/${catalog.destinations.MALTA}`)
        .expect(200);
      expect(used.body).toEqual({ outcome: 'deactivated' });
      const row = await test.prisma.destination.findUniqueOrThrow({
        where: { id: catalog.destinations.MALTA },
      });
      expect(row.isActive).toBe(false);
      expect(await test.prisma.job.count()).toBe(1);
      expect(
        ((await test.http().get(`${API}/destinations`).expect(200)).body as { code: string }[]).map(
          (d) => d.code,
        ),
      ).toEqual(['POLAND']);
      await as(recruiter)
        .delete('/admin/destinations/00000000-0000-4000-8000-000000000000')
        .expect(404);
    });

    it('creates, edits, deletes and deactivates categories the same way', async () => {
      await insertJob(test, catalog, { slug: 'uses-hospitality', category: 'hospitality' });
      const created = await as(recruiter)
        .post('/admin/categories', {
          slug: 'IT-Support',
          name: { en: 'IT', fr: 'Informatique', ar: 'تقنية' },
        })
        .expect(201);
      expect(created.body).toMatchObject({ slug: 'it-support', isActive: true });
      await as(recruiter)
        .post('/admin/categories', { slug: 'it-support', name: { en: 'IT', fr: 'IT', ar: 'IT' } })
        .expect(409);
      await as(recruiter)
        .post('/admin/categories', { slug: 'bad slug', name: { en: 'x', fr: 'x', ar: 'x' } })
        .expect(400);
      const id = (created.body as { id: string }).id;
      expect(
        (await as(recruiter).patch(`/admin/categories/${id}`, { icon: 'laptop' }).expect(200)).body,
      ).toMatchObject({ icon: 'laptop' });

      expect((await as(recruiter).delete(`/admin/categories/${id}`).expect(200)).body).toEqual({
        outcome: 'deleted',
      });
      expect(
        (
          await as(recruiter)
            .delete(`/admin/categories/${catalog.categories.hospitality}`)
            .expect(200)
        ).body,
      ).toEqual({ outcome: 'deactivated' });
      expect(
        (
          await test.prisma.jobCategory.findUniqueOrThrow({
            where: { id: catalog.categories.hospitality },
          })
        ).isActive,
      ).toBe(false);
    });
  });

  describe('audit log', () => {
    it('records every job write with the actor, the job, and its state before and after', async () => {
      const job = await create();
      const id = job.id;
      await as(recruiter).patch(`/admin/jobs/${id}`, { positions: 3 }).expect(200);
      await as(recruiter).post(`/admin/jobs/${id}/publish`).expect(200);
      await as(recruiter).post(`/admin/jobs/${id}/feature`).expect(200);
      await as(recruiter).post(`/admin/jobs/${id}/unfeature`).expect(200);
      await as(recruiter)
        .upload(`/admin/jobs/${id}/cover`, await jpeg(400, 300))
        .expect(200);
      await as(recruiter).delete(`/admin/jobs/${id}/cover`).expect(200);
      await as(recruiter).post(`/admin/jobs/${id}/close`).expect(200);
      await as(recruiter).post(`/admin/jobs/${id}/reopen`).expect(200);
      await as(recruiter).post(`/admin/jobs/${id}/archive`).expect(200);
      const copy = await as(recruiter).post(`/admin/jobs/${id}/duplicate`).expect(201);
      await as(recruiter).delete(`/admin/jobs/${id}`).expect(204);
      await as(recruiter)
        .delete(`/admin/jobs/${(copy.body as { id: string }).id}?permanent=true`)
        .expect(204);

      const entries = await test.prisma.auditLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(entries.map((entry) => entry.action)).toEqual([
        'job.create',
        'job.update',
        'job.publish',
        'job.feature',
        'job.unfeature',
        'job.set_cover',
        'job.remove_cover',
        'job.close',
        'job.reopen',
        'job.archive',
        'job.duplicate',
        'job.delete',
        'job.delete',
      ]);
      for (const entry of entries) {
        expect(entry).toMatchObject({ actorId: recruiter.id, entityType: 'job' });
        expect(entry.entityId).toMatch(/^[0-9a-f-]{36}$/);
      }
      const byAction = (action: string) => entries.find((entry) => entry.action === action);
      expect(byAction('job.create')?.before).toBeNull();
      expect(byAction('job.create')?.after).toMatchObject({
        status: 'DRAFT',
        slug: 'hotel-receptionist-malta',
      });
      expect(byAction('job.update')).toMatchObject({
        before: { positions: 1 },
        after: { positions: 3 },
      });
      expect(byAction('job.publish')).toMatchObject({
        before: { status: 'DRAFT' },
        after: { status: 'PUBLISHED' },
      });
      expect(byAction('job.close')).toMatchObject({
        before: { status: 'PUBLISHED' },
        after: { status: 'CLOSED' },
      });
      expect(byAction('job.duplicate')?.entityId).toBe((copy.body as { id: string }).id);
      const [softDelete, hardDelete] = entries.filter((entry) => entry.action === 'job.delete');
      expect((softDelete?.after as { deletedAt: unknown }).deletedAt).not.toBeNull();
      expect(hardDelete?.before).toMatchObject({ status: 'DRAFT' });
      expect(hardDelete?.after).toBeNull();
    });

    it('records destination and category writes, and nothing for refused ones', async () => {
      const created = await as(recruiter)
        .post('/admin/destinations', {
          code: 'GERMANY',
          name: { en: 'Germany', fr: 'Allemagne', ar: 'ألمانيا' },
        })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await as(recruiter).patch(`/admin/destinations/${id}`, { isActive: false }).expect(200);
      await as(recruiter).delete(`/admin/categories/${catalog.categories.transport}`).expect(200);
      await as(viewer)
        .post('/admin/destinations', {
          code: 'ITALY',
          name: { en: 'Italy', fr: 'Italie', ar: 'إيطاليا' },
        })
        .expect(403);
      await as(recruiter)
        .post('/admin/destinations', {
          code: 'GERMANY',
          name: { en: 'Germany', fr: 'Allemagne', ar: 'ألمانيا' },
        })
        .expect(409);

      const entries = await test.prisma.auditLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(entries.map((entry) => [entry.action, entry.entityType])).toEqual([
        ['destination.create', 'destination'],
        ['destination.update', 'destination'],
        ['category.remove', 'jobCategory'],
      ]);
      expect(entries[1]).toMatchObject({
        before: { isActive: true, code: 'GERMANY' },
        after: { isActive: false },
      });
    });
  });
});
