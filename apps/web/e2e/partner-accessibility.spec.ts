import { expect, test } from '@playwright/test';
import { check } from './axe';
import { adminSession, PDF, STAMP } from './support';

/**
 * axe on every screen of the partner area (ADR-027), in its three languages, signed in as
 * the super admin who joins a space "E2E …" for the test and deletes it afterwards.
 */
test.describe('accessibility of the partner area', () => {
  test.use({ reducedMotion: 'reduce' });

  test('every partner screen', async ({ browser }) => {
    test.setTimeout(180_000);
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();
    for (const lang of ['en', 'fr', 'pl']) {
      await check(page, `/partners/${lang}/login`);
    }
    await check(page, '/partners/pl/forgot-password');
    await check(page, '/partners/fr/reset-password?token=x');
    await anonymous.close();

    const admin = await adminSession(browser);
    const name = `E2E Axe Partner ${STAMP}-${test.info().project.name}`;
    const created = await admin.request.post('/api/v1/admin/partner-spaces', {
      data: { name, country: 'FR', defaultLocale: 'fr' },
    });
    const { id: spaceId } = (await created.json()) as { id: string };
    try {
      const me = (await (await admin.request.get('/api/v1/auth/me')).json()) as { id: string };
      await admin.request.post(`/api/v1/admin/partner-spaces/${spaceId}/members`, {
        data: { userId: me.id },
      });
      const job = (await (
        await admin.request.post(`/api/v1/partner-spaces/${spaceId}/jobs`, {
          data: { role: 'E2E Axe Cook', positions: 2, locations: ['Lyon'] },
        })
      ).json()) as { id: string };
      const application = (await (
        await admin.request.post(`/api/v1/partner-spaces/${spaceId}/applications`, {
          data: { jobId: job.id, firstName: 'Axe', lastName: 'E2E', nationality: 'MA' },
        })
      ).json()) as { id: string };
      const upload = await admin.request.put(
        `/api/v1/partner-spaces/${spaceId}/applications/${application.id}/files/CV`,
        { multipart: { file: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF } } },
      );
      expect(upload.status()).toBe(200);

      const signed = await admin.newPage();
      for (const lang of ['en', 'pl']) {
        const base = `/partners/${lang}/spaces/${spaceId}`;
        await check(signed, `/partners/${lang}`);
        await check(signed, base);
        await check(signed, `${base}/jobs/new`);
        await check(signed, `${base}/jobs/${job.id}`);
        await check(signed, `${base}/applications/new?jobId=${job.id}`);
        await check(signed, `${base}/applications/${application.id}`);
        await check(signed, `${base}/history`);
        await check(signed, `/partners/${lang}/password`);
      }
    } finally {
      await admin.request.delete(`/api/v1/admin/partner-spaces/${spaceId}`, {
        data: { confirmName: name },
      });
      await admin.close();
    }
  });
});
