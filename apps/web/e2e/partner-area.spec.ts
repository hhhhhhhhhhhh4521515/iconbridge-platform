import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminSession, PASSWORD, PDF, pickCountry, STAMP, toast } from './support';

/**
 * The partner area from end to end (ADR-027, section 8), in Polish: the super admin creates
 * a space "E2E …", a login "e2e-partner-…" and becomes a member; the partner signs in with
 * Turnstile, replaces the password, creates a job demand and an application, uploads,
 * previews and downloads a file, comments and reads the history; the super admin deletes
 * the space. `cleanup.ts` removes a space named "E2E …" that a stopped test left.
 */
const NEW_PASSWORD = 'quiet-harbour-lantern-91';

async function createSpace(request: APIRequestContext, name: string) {
  const response = await request.post('/api/v1/admin/partner-spaces', {
    data: { name, country: 'PL', defaultLocale: 'pl' },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

test.describe('partner area', () => {
  test('a partner works in its space, in Polish', async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = await adminSession(browser);
    const project = test.info().project.name;
    const name = `E2E Polska ${STAMP}-${project}`;
    const email = `e2e-partner-${STAMP}-${project}@example.test`;
    const spaceId = await createSpace(admin.request, name);
    const partnerContext = await browser.newContext({ locale: 'pl-PL' });
    try {
      const login = await admin.request.post(`/api/v1/admin/partner-spaces/${spaceId}/logins`, {
        data: { email, displayName: 'E2E Anna', password: PASSWORD },
      });
      expect(login.status()).toBe(201);

      // Sign in, without a language in the address: the space's language follows.
      const page = await partnerContext.newPage();
      await page.goto('/partners');
      await expect(page).toHaveURL(/\/partners\/en\/login/);
      await page.getByRole('link', { name: 'PL', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Logowanie do strefy partnera' }),
      ).toBeVisible();
      await page.getByLabel('Adres e-mail').fill(email);
      await page.getByLabel(/^Hasło/).fill(PASSWORD);
      await page.getByRole('button', { name: 'Zaloguj się' }).click();

      // The password set by the super admin is replaced first.
      await expect(page.getByTestId('forced-password')).toBeVisible();
      await page.getByLabel(/^Obecne hasło/).fill(PASSWORD);
      await page.getByLabel(/^Nowe hasło/).fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Zmień hasło' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Zapotrzebowania' })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/partners/pl/spaces/${spaceId}$`));
      await expect(page.getByRole('banner')).toContainText(name);

      // A job demand.
      await page.getByRole('link', { name: 'Nowe zapotrzebowanie' }).click();
      const job = page.getByTestId('job-form');
      await job.getByLabel('Stanowisko').fill('E2E Spawacz');
      await job.getByLabel('Liczba stanowisk').fill('3');
      await job.getByLabel('Miejsca').fill('Gdańsk\nGdynia');
      await job.getByRole('button', { name: 'Utwórz zapotrzebowanie' }).click();
      await expect(toast(page, 'Zapotrzebowanie utworzone.')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Spawacz' })).toBeVisible();

      // An application, with a rule between fields checked before sending.
      await page.getByRole('link', { name: 'Nowa kandydatura' }).click();
      const form = page.getByTestId('application-form');
      await form.getByLabel('Imię', { exact: true }).fill('Amira');
      await form.getByLabel('Nazwisko', { exact: true }).fill('E2E Testowa');
      await pickCountry(page, /Obywatelstwo/, 'Tun', 'Tunezja');
      await form.getByLabel('Numer przesyłki').fill('JD0146000062');
      await form.getByRole('button', { name: 'Utwórz kandydaturę' }).click();
      await expect(form.getByText('Numer przesyłki wymaga daty wysyłki.')).toBeVisible();
      await form.getByLabel('Numer przesyłki').fill('');
      await form.getByLabel('Status wizy').selectOption('APPOINTMENT_BOOKED');
      await form.getByRole('button', { name: 'Utwórz kandydaturę' }).click();
      await expect(toast(page, 'Kandydatura utworzona.')).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Amira E2E Testowa' }),
      ).toBeVisible();

      // A file: upload, preview (a new tab) and download, each in the history.
      await page.getByTestId('file-input-PASSPORT').setInputFiles({
        name: 'paszport.pdf',
        mimeType: 'application/pdf',
        buffer: PDF,
      });
      await expect(toast(page, 'Plik dodany.')).toBeVisible();
      await expect(page.getByTestId('file-PASSPORT')).toContainText('paszport.pdf');
      // Each button asks for a 5-minute link at the click: a preview to show (a new tab), a
      // download to save. Listened for before the click: the link is requested at once. A
      // headless browser neither displays PDFs nor saves the same way everywhere, so the
      // requests themselves are checked.
      const linkTo = (disposition: RegExp) =>
        partnerContext.waitForEvent('request', {
          predicate: (request) =>
            request.url().includes('/partner-files/spaces/') &&
            disposition.test(new URL(request.url()).searchParams.get('rscd') ?? ''),
        });
      const shown = linkTo(/^inline/);
      await page
        .getByTestId('file-PASSPORT')
        .getByRole('button', { name: /Podgląd/ })
        .click();
      await shown;
      for (const tab of partnerContext.pages().filter((other) => other !== page)) {
        await tab.close();
      }
      const saved = linkTo(/^attachment; filename="paszport\.pdf"/);
      await page
        .getByTestId('file-PASSPORT')
        .getByRole('button', { name: /Pobierz/ })
        .click();
      await saved;
      await expect(page.getByTestId('file-PASSPORT')).toBeVisible();

      // A comment, and the history of the application.
      const comments = page.getByTestId('comments');
      await comments.getByLabel('Nowy komentarz').fill('Paszport otrzymany');
      await comments.getByRole('button', { name: 'Dodaj komentarz' }).click();
      await expect(comments).toContainText('Paszport otrzymany');
      await expect(comments).toContainText('E2E Anna');
      await page.reload();
      const history = page.getByTestId('history');
      await expect(history).toContainText('Plik dodany');
      await expect(history).toContainText('Podgląd pliku');
      await expect(history).toContainText('Plik pobrany');
      await expect(history).toContainText('Kandydatura utworzona');

      // The history of the space, filtered.
      await page.getByRole('banner').getByRole('link', { name: 'Historia' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Historia przestrzeni' }),
      ).toBeVisible();
      await page.getByLabel('Pokaż').selectOption('job');
      await expect(page.getByTestId('history')).toContainText('Zapotrzebowanie utworzone');
      await expect(page.getByTestId('history')).not.toContainText('Plik dodany');

      // The partner login cannot open the back office.
      await page.goto('/en/admin');
      await expect(page.getByTestId('admin-forbidden')).toBeVisible();
    } finally {
      await partnerContext.close();
      const removed = await admin.request.delete(`/api/v1/admin/partner-spaces/${spaceId}`, {
        data: { confirmName: name },
      });
      expect(removed.status()).toBe(204);
      await admin.close();
    }
  });

  test('a stranger sees nothing, and the reset email speaks Polish', async ({ browser }) => {
    const admin = await adminSession(browser);
    const project = test.info().project.name;
    const name = `E2E Obcy ${STAMP}-${project}`;
    const spaceId = await createSpace(admin.request, name);
    const visitor = await browser.newContext();
    try {
      const page = await visitor.newPage();
      // Without a session: the partner sign-in, never the content.
      await page.goto(`/partners/pl/spaces/${spaceId}`);
      await expect(page).toHaveURL(/\/partners\/pl\/login\?next=/);
      // The super admin who is not a member gets "not found" in the partner area.
      const own = await admin.newPage();
      await own.goto(`/partners/en/spaces/${spaceId}`);
      await expect(own.getByTestId('space-not-found')).toBeVisible();
      await own.close();
      // Forgot password: the same answer for any address.
      await page.goto('/partners/pl/forgot-password');
      await page.getByLabel('Adres e-mail').fill(`e2e-nobody-${STAMP}@example.test`);
      await page.getByRole('button', { name: 'Wyślij link' }).click();
      await expect(page.getByRole('status')).toContainText('Jeśli ten adres należy');
    } finally {
      await visitor.close();
      await admin.request.delete(`/api/v1/admin/partner-spaces/${spaceId}`, {
        data: { confirmName: name },
      });
      await admin.close();
    }
  });
});
