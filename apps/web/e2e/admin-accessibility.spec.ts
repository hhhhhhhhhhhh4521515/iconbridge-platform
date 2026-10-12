import { test } from '@playwright/test';
import { check } from './axe';
import { adminSession } from './support';

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
        '/fr/admin',
      ]) {
        await check(page, path);
      }
    } finally {
      await admin.close();
    }
  });
});
