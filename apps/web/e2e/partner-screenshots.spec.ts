import { expect, test, type Page } from '@playwright/test';
import { adminSession, PDF, STAMP } from './support';

/**
 * Screenshots of every partner screen in English, desktop and phone, for a pull request or
 * the docs. Off by default; `PARTNER_SCREENSHOTS=<folder>` turns it on, for example
 * `PARTNER_SCREENSHOTS=../../docs/screenshots/partner-area pnpm exec playwright test
 * partner-screenshots --project=admin`. The data are invented, in a space "E2E …" that the
 * test deletes.
 */
const OUT = process.env.PARTNER_SCREENSHOTS;

test.describe('screenshots of the partner area', () => {
  test.skip(!OUT, 'PARTNER_SCREENSHOTS is not set');
  test.use({ reducedMotion: 'reduce' });

  test('every partner screen, desktop and phone', async ({ browser }) => {
    test.setTimeout(300_000);
    const admin = await adminSession(browser);
    const name = `E2E Baltic Hotels ${STAMP}`;
    const created = await admin.request.post('/api/v1/admin/partner-spaces', {
      data: { name, country: 'PL', defaultLocale: 'en' },
    });
    const { id: spaceId } = (await created.json()) as { id: string };
    try {
      const me = (await (await admin.request.get('/api/v1/auth/me')).json()) as { id: string };
      await admin.request.post(`/api/v1/admin/partner-spaces/${spaceId}/members`, {
        data: { userId: me.id },
      });
      const post = async (path: string, data: object) => {
        const response = await admin.request.post(`/api/v1/partner-spaces/${spaceId}${path}`, {
          data,
        });
        expect(response.status()).toBe(201);
        return (await response.json()) as { id: string };
      };
      const job = await post('/jobs', {
        role: 'E2E Housekeeping',
        positions: 5,
        locations: ['Gdańsk', 'Sopot'],
        salaryAmount: 4500,
        salaryCurrency: 'PLN',
        salaryPeriod: 'MONTH',
        salary: 'gross, plus accommodation',
        description: 'Rooms and common areas of a 4-star hotel by the sea. Six days a week.',
      });
      await post('/jobs', {
        role: 'E2E Kitchen assistant',
        positions: 3,
        locations: ['Kraków'],
        salaryAmount: 28,
        salaryCurrency: 'PLN',
        salaryPeriod: 'HOUR',
      });
      const people = [
        ['Amina', 'APPROVED', 'APPROVED', '2026-11-02'],
        ['Youssef', 'APPROVED', 'APPOINTMENT_BOOKED', null],
        ['Leila', 'SUBMITTED', 'NOT_STARTED', null],
        ['Karim', 'REFUSED', 'NOT_STARTED', null],
      ] as const;
      const ids: string[] = [];
      for (const [firstName, workPermitStatus, visaStatus, decision] of people) {
        const application = await post('/applications', {
          jobId: job.id,
          firstName,
          lastName: 'E2E',
          nationality: firstName === 'Leila' ? 'TN' : 'MA',
          workPermitStatus,
          workPermitSubmittedDate: '2026-09-15',
          ...(workPermitStatus === 'SUBMITTED' ? {} : { workPermitDecisionDate: '2026-10-10' }),
          visaStatus,
          ...(visaStatus === 'NOT_STARTED' ? {} : { visaAppointmentDate: '2026-10-20' }),
          ...(decision
            ? {
                visaDecisionDate: decision,
                dhlSentDate: '2026-11-05',
                dhlTrackingNumber: 'JD0146000062',
              }
            : {}),
        });
        ids.push(application.id);
      }
      const amina = ids[0] ?? '';
      await admin.request.put(
        `/api/v1/partner-spaces/${spaceId}/applications/${amina}/files/PASSPORT`,
        { multipart: { file: { name: 'passport.pdf', mimeType: 'application/pdf', buffer: PDF } } },
      );
      await post(`/applications/${amina}/comments`, { body: 'Passport received, thank you.' });
      await post(`/applications/${amina}/comments`, { body: 'Visa approved, DHL on its way.' });

      const base = `/partners/en/spaces/${spaceId}`;
      const screens: [string, string][] = [
        ['01-home', base],
        ['02-job', `${base}/jobs/${job.id}`],
        ['03-application', `${base}/applications/${amina}`],
        ['04-new-job', `${base}/jobs/new`],
        ['05-new-application', `${base}/applications/new?jobId=${job.id}`],
        ['06-history', `${base}/history`],
        ['07-password', '/partners/en/password'],
      ];
      const shoot = async (page: Page, file: string, path: string) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('loading')).toHaveCount(0);
        await page.screenshot({ path: `${OUT ?? '.'}/${file}.png`, fullPage: true });
      };
      for (const [size, viewport] of [
        ['desktop', { width: 1440, height: 900 }],
        ['mobile', { width: 390, height: 844 }],
      ] as const) {
        const signed = await admin.newPage();
        await signed.setViewportSize(viewport);
        for (const [file, path] of screens) {
          await shoot(signed, `${file}-${size}`, path);
        }
        await signed.close();
        const anonymous = await browser.newContext({ viewport });
        const page = await anonymous.newPage();
        await shoot(page, `08-login-${size}`, '/partners/en/login');
        await shoot(page, `09-forgot-password-${size}`, '/partners/en/forgot-password');
        await anonymous.close();
      }
    } finally {
      await admin.request.delete(`/api/v1/admin/partner-spaces/${spaceId}`, {
        data: { confirmName: name },
      });
      await admin.close();
    }
  });
});
