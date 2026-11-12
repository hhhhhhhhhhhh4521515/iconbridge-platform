import { expect, test } from '@playwright/test';
import { check } from './axe';
import { adminSession, STAMP } from './support';

/** axe on the screens of the back office, signed in as the super admin. */
test.describe('accessibility of the back office', () => {
  test.use({ reducedMotion: 'reduce' });

  test('every screen of the menu', async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = await adminSession(browser);
    try {
      const page = await admin.newPage();
      for (const path of [
        '/en/admin',
        '/en/admin/jobs',
        '/en/admin/jobs/new',
        '/en/admin/applications',
        '/en/admin/applications?view=board',
        '/en/admin/candidates',
        '/en/admin/content/stories',
        '/en/admin/content/slides',
        '/en/admin/content/catalog',
        '/en/admin/messages',
        '/en/admin/users',
        '/en/admin/settings',
        '/en/admin/audit',
        '/en/admin/password',
        '/en/admin/partner-spaces',
        '/fr/admin',
      ]) {
        await check(page, path);
      }
    } finally {
      await admin.close();
    }
  });

  test('a partner space (ADR-027)', async ({ browser }) => {
    const admin = await adminSession(browser);
    const created = await admin.request.post('/api/v1/admin/partner-spaces', {
      data: { name: `E2E Axe ${STAMP}`, country: 'PL', defaultLocale: 'pl' },
    });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    try {
      const page = await admin.newPage();
      await check(page, `/en/admin/partner-spaces/${id}`);
      await check(page, `/fr/admin/partner-spaces/${id}`);
    } finally {
      await admin.request.delete(`/api/v1/admin/partner-spaces/${id}`, {
        data: { confirmName: `E2E Axe ${STAMP}` },
      });
      await admin.close();
    }
  });
});
