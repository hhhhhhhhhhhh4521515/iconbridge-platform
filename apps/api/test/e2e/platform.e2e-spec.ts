import type { ConfigService } from '@nestjs/config';
import { CatalogService } from '../../src/catalog/catalog.service.js';
import type { Env } from '../../src/config/env.js';
import { SiteCacheService } from '../../src/site-cache/site-cache.service.js';
import {
  API,
  createTestApp,
  createUser,
  insertJob,
  PASSWORD,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type TestApp,
  type TestUser,
} from './app.js';
import { as } from './back-office.js';

describe('platform behaviour (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
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
    catalog = await seedCatalog(test);
    viewer = await createUser(test, 'VIEWER', 'viewer@example.test');
    recruiter = await createUser(test, 'RECRUITER');
    superAdmin = await createUser(test, 'SUPER_ADMIN');
    test.outbox.length = 0;
  });

  describe('deleting a back-office account', () => {
    it('signs the account out, frees its address and removes it from the list', async () => {
      await as(test, superAdmin).delete(`/admin/users/${viewer.id}`).expect(204);

      await as(test, viewer).get('/admin/stats').expect(401);
      await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: 'viewer@example.test', password: PASSWORD })
        .expect(401);
      const list = (await as(test, superAdmin).get('/admin/users').expect(200)).body as {
        items: { id: string }[];
      };
      expect(list.items.map((item) => item.id)).not.toContain(viewer.id);
      const row = await test.prisma.user.findUniqueOrThrow({ where: { id: viewer.id } });
      expect(row).toMatchObject({ isActive: false, passwordHash: null });
      expect(row.email).toMatch(/^deleted-.*@deleted\.invalid$/);
      expect(row.deletedAt).not.toBeNull();

      // The address can be invited again.
      await as(test, superAdmin)
        .post('/admin/users', { email: 'viewer@example.test', role: 'VIEWER', locale: 'en' })
        .expect(201);
      const entry = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin_user.delete' },
      });
      expect(entry).toMatchObject({ actorId: superAdmin.id, entityId: viewer.id });
    });

    it('is for super admins only, never on oneself, and keeps one super admin', async () => {
      await as(test, recruiter).delete(`/admin/users/${viewer.id}`).expect(403);
      await as(test, viewer).delete(`/admin/users/${recruiter.id}`).expect(403);
      await test.http().delete(`${API}/admin/users/${viewer.id}`).expect(401);
      const self = await as(test, superAdmin).delete(`/admin/users/${superAdmin.id}`).expect(409);
      expect((self.body as { code: string }).code).toBe('CANNOT_DISABLE_SELF');
      await as(test, superAdmin)
        .delete('/admin/users/00000000-0000-4000-8000-000000000000')
        .expect(404);
      // A candidate is not a back-office account: this route does not delete candidates.
      const candidate = await createUser(test, 'CANDIDATE');
      await as(test, superAdmin).delete(`/admin/users/${candidate.id}`).expect(404);

      const second = await createUser(test, 'SUPER_ADMIN');
      await as(test, second).delete(`/admin/users/${superAdmin.id}`).expect(204);
      expect(
        await test.prisma.user.count({ where: { role: 'SUPER_ADMIN', deletedAt: null } }),
      ).toBe(1);
    });
  });

  describe('caching of public answers', () => {
    it('lets browsers keep public data for a minute, and nothing personal', async () => {
      await insertJob(test, catalog, { slug: 'welder' });
      for (const path of [
        '/jobs',
        '/jobs/welder',
        '/destinations',
        '/categories',
        '/success-stories',
        '/home-slides',
        '/site-info',
      ]) {
        const response = await test.http().get(`${API}${path}`).expect(200);
        expect(response.headers['cache-control'], path).toBe(
          'public, max-age=60, stale-while-revalidate=120',
        );
        expect(response.headers['set-cookie'], path).toBeUndefined();
      }
      for (const path of ['/admin/stats', '/admin/applications', '/auth/session']) {
        const response = await as(test, viewer).get(path).expect(200);
        expect(response.headers['cache-control'] ?? '', path).not.toContain('public');
      }
    });
  });

  describe('telling the public site that content changed', () => {
    it('asks for a refresh after a successful write of the back office, and only then', async () => {
      const invalidate = vi.spyOn(test.app.get(SiteCacheService), 'invalidate');
      const job = await insertJob(test, catalog, { slug: 'draft', status: 'DRAFT' });

      await as(test, recruiter).get('/admin/jobs').expect(200);
      expect(invalidate).not.toHaveBeenCalled();
      // A refused write changes nothing on the site.
      await as(test, viewer).post(`/admin/jobs/${job.id}/publish`).expect(403);
      await as(test, recruiter).patch(`/admin/jobs/${job.id}`, { positions: -3 }).expect(400);
      expect(invalidate).not.toHaveBeenCalled();

      await as(test, recruiter).post(`/admin/jobs/${job.id}/publish`).expect(200);
      expect(invalidate).toHaveBeenLastCalledWith(['jobs', 'catalog', 'stats']);
      await as(test, superAdmin)
        .put('/admin/settings/CONTACT_PHONE', { value: '+356 2100 0000' })
        .expect(200);
      expect(invalidate).toHaveBeenLastCalledWith(['site-info', 'stats']);
      await as(test, recruiter)
        .post('/admin/home-slides', {
          title: { en: 'Work in Malta', fr: 'Travaillez à Malte', ar: 'اعمل في مالطا' },
        })
        .expect(201);
      expect(invalidate).toHaveBeenLastCalledWith(['slides']);
      invalidate.mockRestore();
    });

    it('does not fail or wait when the web app cannot be reached', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      const config = {
        get: (key: string) =>
          ({
            REVALIDATE_SECRET: 'x'.repeat(32),
            WEB_INTERNAL_URL: 'http://127.0.0.1:9',
            WEB_ORIGIN: 'http://localhost:3000',
          })[key],
      } as unknown as ConfigService<Env, true>;
      const withSecret = new SiteCacheService(config, test.app.get(CatalogService));
      expect(() => {
        withSecret.invalidate(['jobs']);
      }).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:9/api/revalidate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ tags: ['jobs'] }),
          headers: expect.objectContaining({ 'x-revalidate-secret': 'x'.repeat(32) }) as unknown,
        }),
      );
      fetchMock.mockRestore();
    });
  });
});
