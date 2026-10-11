import type { ConfigService } from '@nestjs/config';
import { ApplicationsService } from '../../src/applications/applications.service.js';
import { AdminApplicationsService } from '../../src/admin/applications/admin-applications.service.js';
import type { Env } from '../../src/config/env.js';
import { AzureStorageService } from '../../src/storage/azure-storage.service.js';
import {
  createReadyCandidate,
  createTestApp,
  createUser,
  insertJob,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type TestApp,
  type TestUser,
} from './app.js';
import { applyTo, as } from './back-office.js';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const authUser = (user: TestUser, emailVerified = true) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  emailVerified,
  locale: 'en' as const,
});

/**
 * Branches that the HTTP layer normally stops earlier (a guard answers first), called
 * on the services directly: the rules must hold even if a route forgets its guard.
 */
describe('rules behind the guards (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.clock.reset();
    catalog = await seedCatalog(test);
  });

  it('refuses an application from an unverified address in the service itself', async () => {
    const candidate = await createReadyCandidate(test);
    const job = await insertJob(test, catalog, { slug: 'job' });
    const service = test.app.get(ApplicationsService);
    await expect(
      service.apply(
        authUser(candidate, false) as never,
        job.id,
        { documentIds: [candidate.cvId, candidate.passportId], turnstileToken: 'ok' },
        null,
      ),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    expect(await test.prisma.application.count()).toBe(0);
    expect(
      (await service.eligibility(authUser(candidate, false) as never, job.id)).reasons,
    ).toContain('EMAIL_NOT_VERIFIED');
  });

  it('answers "not found" when withdrawing or undoing an application that does not exist', async () => {
    const candidate = await createReadyCandidate(test);
    const recruiter = await createUser(test, 'RECRUITER');
    await expect(
      test.app.get(ApplicationsService).withdrawOwn(authUser(candidate) as never, UNKNOWN),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await as(test, recruiter).post(`/admin/applications/${UNKNOWN}/undo-status`).expect(404);
    await as(test, recruiter)
      .post(`/admin/applications/${UNKNOWN}/notes`, { body: 'x' })
      .expect(404);
    await as(test, recruiter)
      .patch(`/admin/applications/${UNKNOWN}/status`, { status: 'UNDER_REVIEW' })
      .expect(404);
  });

  it('gives back the withdrawal date when a super admin undoes a reopening', async () => {
    const candidate = await createReadyCandidate(test);
    const superAdmin = await createUser(test, 'SUPER_ADMIN');
    const job = await insertJob(test, catalog, { slug: 'job' });
    const id = await applyTo(test, candidate, job.id);
    await as(test, candidate).post(`/me/applications/${id}/withdraw`).expect(200);
    const withdrawnAt = (await test.prisma.application.findUniqueOrThrow({ where: { id } }))
      .withdrawnAt;

    await as(test, superAdmin)
      .patch(`/admin/applications/${id}/status`, { status: 'UNDER_REVIEW' })
      .expect(200);
    expect(
      (await test.prisma.application.findUniqueOrThrow({ where: { id } })).withdrawnAt,
    ).toBeNull();
    await as(test, superAdmin).post(`/admin/applications/${id}/undo-status`).expect(200);
    const restored = await test.prisma.application.findUniqueOrThrow({ where: { id } });
    expect(restored.status).toBe('WITHDRAWN');
    expect(restored.withdrawnAt?.getTime()).toBeCloseTo(withdrawnAt?.getTime() ?? 0, -3);
  });

  it('stops a bulk change on an unexpected error instead of hiding it', async () => {
    const recruiter = await createUser(test, 'RECRUITER');
    const service = test.app.get(AdminApplicationsService);
    const broken = vi
      .spyOn(test.prisma, '$transaction')
      .mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      service.bulkChangeStatus(
        { ids: [UNKNOWN], status: 'UNDER_REVIEW' },
        authUser(recruiter) as never,
        null,
      ),
    ).rejects.toThrow('connection lost');
    broken.mockRestore();
  });
});

/** The real storage service, against the local emulator (Azurite) started by `pnpm infra:up`. */
describe('Azure storage service (integration)', () => {
  const values: Record<string, string> = {
    AZURE_STORAGE_CONNECTION_STRING:
      'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
      'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
      'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;',
    AZURE_STORAGE_ACCOUNT_URL: '',
    PUBLIC_MEDIA_BASE_URL: 'http://127.0.0.1:10000/devstoreaccount1/public-media',
  };
  const storage = new AzureStorageService({
    get: (key: string) => values[key],
  } as unknown as ConfigService<Env, true>);
  const name = `test/${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  it('stores a public file that anybody can read at its public address, then deletes it', async () => {
    const path = `${name}/picture one.webp`;
    await storage.uploadPublic(path, Buffer.from('public-content'), 'image/webp');
    const url = storage.publicUrl(path) ?? '';
    expect(url).toContain('/public-media/test/');
    expect(url).toContain('picture%20one.webp');
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(await response.text()).toBe('public-content');

    await storage.deletePublic(path);
    expect((await fetch(url)).status).toBe(404);
    // Deleting again is harmless.
    await storage.deletePublic(path);
    expect(storage.publicUrl(null)).toBeNull();
  });

  it('keeps a private file out of reach without a signed link, and serves it with one', async () => {
    const path = `${name}/passport.pdf`;
    await storage.uploadPrivate(path, Buffer.from('%PDF-private'), 'application/pdf');
    const plain = `http://127.0.0.1:10000/devstoreaccount1/candidate-documents/${path}`;
    expect([403, 404, 409]).toContain((await fetch(plain)).status);

    const download = await storage.privateDownloadUrl(path, {
      fileName: 'Passeport Amira.pdf',
      contentType: 'application/pdf',
    });
    const saved = await fetch(download);
    expect(saved.status).toBe(200);
    expect(await saved.text()).toBe('%PDF-private');
    expect(saved.headers.get('content-disposition')).toMatch(
      /^attachment; filename="Passeport Amira.pdf"/,
    );
    expect(saved.headers.get('cache-control')).toBe('private, no-store');
    // Read-only, and short-lived: the link carries its expiry.
    expect(new URL(download).searchParams.get('sp')).toBe('r');
    const expires = new Date(new URL(download).searchParams.get('se') ?? '').getTime();
    expect(expires - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 5000);
    expect(expires - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(
      (
        await fetch(download, {
          method: 'PUT',
          body: 'x',
          headers: { 'x-ms-blob-type': 'BlockBlob' },
        })
      ).status,
    ).toBe(403);

    const preview = await storage.privateDownloadUrl(path, {
      fileName: 'p.pdf',
      contentType: 'application/pdf',
      inline: true,
      expiresInSeconds: 30,
    });
    expect((await fetch(preview)).headers.get('content-disposition')).toMatch(/^inline;/);

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.readPrivate(path)) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-private');

    await storage.deletePrivate(path);
    expect((await fetch(download)).status).toBe(404);
    await storage.deletePrivate(path);
  });

  it('refuses a signed link that was tampered with', async () => {
    const path = `${name}/cv.pdf`;
    await storage.uploadPrivate(path, Buffer.from('cv'), 'application/pdf');
    const link = await storage.privateDownloadUrl(path, {
      fileName: 'cv.pdf',
      contentType: 'application/pdf',
    });
    const other = link.replace('cv.pdf?', 'passport.pdf?');
    expect((await fetch(other)).status).toBe(403);
    await storage.deletePrivate(path);
  });
});
