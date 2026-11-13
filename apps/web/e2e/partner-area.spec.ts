import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { adminSession, PASSWORD, PDF, pickCountry, STAMP, toast } from './support';

/**
 * The partner area from end to end (ADR-027, section 8), in Polish: the super admin creates
 * a space "E2E …", a login "e2e-partner-…" and becomes a member; the partner signs in with
 * Turnstile, replaces the password, creates a job demand and an application, uploads,
 * previews and downloads a file, comments and reads the history; the super admin deletes
 * the space. `cleanup.ts` removes a space named "E2E …" that a stopped test left.
 */
const NEW_PASSWORD = 'quiet-harbour-lantern-91';

/**
 * Fills a form until React holds the values, then sends it: a page just opened can take the
 * typing before it hydrates (seen in WebKit under load), and hydration then empties the
 * fields. The partner forms enable their button only once the fields are in React's state.
 */
async function fillAndSend(page: Page, fields: [Locator, string][], button: string) {
  const send = page.getByRole('button', { name: button });
  await expect(async () => {
    for (const [field, value] of fields) {
      await field.fill(value);
    }
    await expect(send).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await send.click();
}

/** The partner sign-in, in Polish. */
const signIn = (page: Page, email: string, password: string) =>
  fillAndSend(
    page,
    [
      [page.getByLabel('Adres e-mail'), email],
      [page.getByLabel(/^Hasło/), password],
    ],
    'Zaloguj się',
  );

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
      await signIn(page, email, PASSWORD);

      // The password set by the super admin is replaced first.
      await expect(page.getByTestId('forced-password')).toBeVisible();
      await page.getByLabel(/^Obecne hasło/).fill(PASSWORD);
      await page.getByLabel(/^Nowe hasło/).fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Zmień hasło' }).click();
      // Three calls after the redirect (session, space, job demands): slow under a full run.
      await expect(page.getByRole('heading', { level: 1, name: 'Zapotrzebowania' })).toBeVisible({
        timeout: 15_000,
      });
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

  test('the work permit comes before the visa, with counts, a filter and its history, in Polish', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const admin = await adminSession(browser);
    const project = test.info().project.name;
    const name = `E2E Zezwolenie ${STAMP}-${project}`;
    const email = `e2e-partner-permit-${STAMP}-${project}@example.test`;
    const spaceId = await createSpace(admin.request, name);
    const partnerContext = await browser.newContext({ locale: 'pl-PL' });
    try {
      const login = await admin.request.post(`/api/v1/admin/partner-spaces/${spaceId}/logins`, {
        data: { email, displayName: 'E2E Ola', password: PASSWORD },
      });
      expect(login.status()).toBe(201);
      const page = await partnerContext.newPage();
      await page.goto('/partners/pl/login');
      await signIn(page, email, PASSWORD);
      await expect(page.getByTestId('forced-password')).toBeVisible();
      await page.getByLabel(/^Obecne hasło/).fill(PASSWORD);
      await page.getByLabel(/^Nowe hasło/).fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Zmień hasło' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Zapotrzebowania' })).toBeVisible({
        timeout: 15_000,
      });

      // A job demand and two applications, through the API with the partner's own session.
      const jobResponse = await page.request.post(`/api/v1/partner-spaces/${spaceId}/jobs`, {
        data: { role: 'E2E Kucharz', positions: 2, locations: ['Kraków'] },
      });
      expect(jobResponse.status()).toBe(201);
      const jobId = ((await jobResponse.json()) as { id: string }).id;
      for (const [firstName, workPermitStatus] of [
        ['Nadia', 'NOT_STARTED'],
        ['Omar', 'SUBMITTED'],
      ] as const) {
        const created = await page.request.post(`/api/v1/partner-spaces/${spaceId}/applications`, {
          data: { jobId, firstName, lastName: 'E2E', nationality: 'MA', workPermitStatus },
        });
        expect(created.status()).toBe(201);
      }

      // The job demand: a badge per application, counts that filter the table.
      await page.goto(`/partners/pl/spaces/${spaceId}/jobs/${jobId}`);
      const table = page.getByTestId('applications-table');
      await expect(table.getByRole('columnheader', { name: 'Zezwolenie na pracę' })).toBeVisible();
      await expect(table.getByRole('row', { name: /Omar E2E/ })).toContainText('Złożone');
      await expect(table.getByRole('row', { name: /Nadia E2E/ })).toContainText('Nierozpoczęte');
      const filter = page.getByRole('group', {
        name: 'Filtruj według statusu zezwolenia na pracę',
      });
      await expect(filter.getByRole('button', { name: 'Wszystkie 2' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await filter.getByRole('button', { name: 'Złożone 1' }).click();
      await expect(filter.getByRole('button', { name: 'Złożone 1' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(table.getByRole('row')).toHaveCount(2);
      await expect(table).toContainText('Omar E2E');
      await filter.getByRole('button', { name: 'Odmowa 0' }).click();
      await expect(page.getByText('Żadna kandydatura nie pasuje do tych filtrów.')).toBeVisible();
      await filter.getByRole('button', { name: 'Wszystkie 2' }).click();
      await table.getByRole('link', { name: 'Omar E2E' }).click();

      // The application: the work permit section above the visa section.
      const form = page.getByTestId('application-form');
      await expect(form.locator(':scope > fieldset > legend')).toHaveText([
        'Osoba',
        'Zezwolenie na pracę',
        'Wiza',
        'DHL',
      ]);
      const section = page.getByTestId('work-permit-section');
      await expect(section.getByLabel('Status zezwolenia na pracę')).toHaveValue('SUBMITTED');
      // The decision date shows only once the work permit is decided.
      await expect(section.getByText('Data decyzji')).toHaveCount(0);
      await section.getByLabel('Status zezwolenia na pracę').selectOption('APPROVED');
      await expect(section.getByText('Data decyzji').first()).toBeVisible();
      await expect(section).toContainText('Samo zezwolenie na pracę dodaj w sekcji Pliki.');
      await form.getByRole('button', { name: 'Zapisz' }).click();
      await expect(toast(page, 'Kandydatura zapisana.')).toBeVisible();
      await expect(page.getByTestId('work-permit-badge').first()).toHaveText('Przyznane');
      // The work permit file stays in the Files box.
      await expect(page.getByTestId('file-WORK_PERMIT')).toContainText('Zezwolenie na pracę');

      // Every change in the history, in Polish.
      await page.reload();
      await expect(page.getByTestId('history')).toContainText(
        'status zezwolenia na pracę: Złożone → Przyznane',
      );
      await page.goto(`/partners/pl/spaces/${spaceId}/jobs/${jobId}`);
      await expect(filter.getByRole('button', { name: 'Przyznane 1' })).toBeVisible();
    } finally {
      await partnerContext.close();
      const removed = await admin.request.delete(`/api/v1/admin/partner-spaces/${spaceId}`, {
        data: { confirmName: name },
      });
      expect(removed.status()).toBe(204);
      await admin.close();
    }
  });

  test('the dashboard, a job demand and an application, in English', async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = await adminSession(browser);
    const name = `E2E Dashboard ${STAMP}-${test.info().project.name}`;
    const spaceId = await createSpace(admin.request, name);
    try {
      // The super admin joins the space: the only member who may delete.
      const me = (await (await admin.request.get('/api/v1/auth/me')).json()) as { id: string };
      expect(
        (
          await admin.request.post(`/api/v1/admin/partner-spaces/${spaceId}/members`, {
            data: { userId: me.id },
          })
        ).status(),
      ).toBe(201);
      const page = await admin.newPage();
      const base = `/partners/en/spaces/${spaceId}`;

      // An empty space: the band, zero counts and the first step.
      await page.goto(base);
      await expect(page.getByTestId('space-band')).toContainText(name);
      await expect(page.getByTestId('space-band')).toContainText('Poland');
      const summary = page.getByRole('list', { name: 'Summary of the space' });
      await expect(summary.getByRole('listitem')).toHaveText([
        /Open demands\s*0/,
        /Candidates\s*0/,
        /Work permits approved\s*0/,
        /Visas approved\s*0/,
      ]);
      await page.getByRole('link', { name: 'Create the first job demand' }).click();

      // A job demand with a salary: amount, currency and period go together.
      const form = page.getByTestId('job-form');
      await form.getByLabel('Role').fill('E2E Welder');
      await form.getByLabel('Number of positions').fill('5');
      await form.getByLabel('Places').fill('Gdańsk');
      await form.getByLabel('Amount').fill('3000');
      await form.getByRole('button', { name: 'Create the job demand' }).click();
      await expect(
        form.getByText('Give an amount, a currency and a period, or none of them.'),
      ).toBeVisible();
      await form.getByLabel('Currency').selectOption('PLN');
      await form.getByLabel('Per', { exact: true }).selectOption('MONTH');
      await form.getByRole('button', { name: 'Create the job demand' }).click();
      await expect(toast(page, 'Job demand created.')).toBeVisible();
      const facts = page.getByTestId('job-summary');
      await expect(facts).toContainText('Positions5');
      await expect(facts).toContainText('3,000 PLN / month');
      await expect(facts).toContainText('0 / 5 filled');
      const jobId = /jobs\/([0-9a-f-]+)$/.exec(page.url())?.[1] ?? '';

      // Two people: one with an approved visa, one not started.
      for (const [firstName, visaStatus] of [
        ['Nadia', 'APPROVED'],
        ['Omar', 'NOT_STARTED'],
      ] as const) {
        const created = await page.request.post(`/api/v1/partner-spaces/${spaceId}/applications`, {
          data: {
            jobId,
            firstName,
            lastName: 'E2E',
            nationality: 'MA',
            visaStatus,
            ...(visaStatus === 'APPROVED' ? { visaDecisionDate: '2026-11-02' } : {}),
          },
        });
        expect(created.status()).toBe(201);
      }

      // The job demand: chips per visa status, and a search by name.
      await page.reload();
      const table = page.getByTestId('applications-table');
      await expect(table.getByRole('row')).toHaveCount(3);
      await expect(
        table.getByRole('row', { name: /Nadia E2E/ }).getByTestId('visa-badge'),
      ).toHaveAttribute('data-tone', 'green');
      const visa = page.getByRole('group', { name: 'Filter by visa status' });
      await visa.getByRole('button', { name: 'Approved 1' }).click();
      await expect(table.getByRole('row')).toHaveCount(2);
      await expect(table).toContainText('Nadia E2E');
      await visa.getByRole('button', { name: 'All 2' }).click();
      await page.getByLabel('Search by name').fill('omar');
      await expect(table.getByRole('row')).toHaveCount(2);
      await expect(table).toContainText('Omar E2E');
      await page.getByLabel('Search by name').fill('nobody');
      await expect(page.getByText('No application matches these filters.')).toBeVisible();
      await page.getByLabel('Search by name').fill('');
      await expect(facts).toContainText('1 / 5 filled');
      await table.getByRole('link', { name: 'Omar E2E' }).click();

      // The application: the steps, a date from the calendar, the bar that saves.
      const stepper = page.getByTestId('progress-stepper');
      await expect(stepper.locator('[data-step="appointment"]')).toHaveAttribute(
        'data-state',
        'todo',
      );
      await expect(page.getByTestId('save-bar')).toHaveCount(0);
      const application = page.getByTestId('application-form');
      await application.getByLabel('Visa status').selectOption('APPOINTMENT_BOOKED');
      await application.getByRole('button', { name: /^Appointment date/ }).click();
      const calendar = page.getByRole('dialog', { name: 'Appointment date' });
      await calendar.getByLabel('Year').selectOption('2026');
      await calendar.getByLabel('Month', { exact: true }).selectOption({ label: 'December' });
      await calendar.getByRole('button', { name: 'Friday, December 4, 2026' }).click();
      await expect(calendar).toHaveCount(0);
      await expect(application.getByRole('button', { name: /^Appointment date/ })).toContainText(
        'Dec 4, 2026',
      );
      const bar = page.getByTestId('save-bar');
      await expect(bar).toContainText('You have unsaved changes.');
      await bar.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page, 'Application saved.')).toBeVisible();
      await expect(bar).toHaveCount(0);
      await expect(stepper.locator('[data-step="appointment"]')).toHaveAttribute(
        'data-state',
        'done',
      );
      await expect(stepper.locator('[data-step="appointment"]')).toContainText('Dec 4, 2026');
      // Discarding puts the saved values back.
      await application.getByLabel('First name').fill('Changed');
      await page.getByTestId('save-bar').getByRole('button', { name: 'Discard' }).click();
      await expect(application.getByLabel('First name')).toHaveValue('Omar');
      await expect(page.getByTestId('save-bar')).toHaveCount(0);
      // The history as a timeline.
      await page.reload();
      await expect(page.getByTestId('history')).toContainText(
        'appointment date: (empty) → Dec 4, 2026',
      );

      // An empty job demand can be deleted by the super admin, after typing its role.
      const empty = await page.request.post(`/api/v1/partner-spaces/${spaceId}/jobs`, {
        data: { role: 'E2E Empty', positions: 1, locations: ['Łódź'] },
      });
      const emptyId = ((await empty.json()) as { id: string }).id;
      await page.goto(`${base}/jobs/${emptyId}`);
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = page.getByTestId('delete-job-form');
      const confirm = dialog.getByRole('button', { name: 'Delete for good' });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(/Type the role to confirm/).fill('E2E Empty');
      await confirm.click();
      await expect(page).toHaveURL(new RegExp(`${base}$`));
      await expect(page.getByTestId('job-card')).toHaveCount(1);
      await expect(summary.getByRole('listitem')).toHaveText([
        /Open demands\s*1/,
        /Candidates\s*2/,
        /Work permits approved\s*0/,
        /Visas approved\s*1/,
      ]);
      // A job demand with applications offers no deletion.
      await page.goto(`${base}/jobs/${jobId}`);
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Welder' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
      await page.goto(`${base}/history`);
      await expect(page.getByTestId('history')).toContainText('Job demand deleted');
      await expect(page.getByTestId('history')).toContainText('role: E2E Empty → (empty)');
    } finally {
      await admin.request.delete(`/api/v1/admin/partner-spaces/${spaceId}`, {
        data: { confirmName: name },
      });
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
      await fillAndSend(
        page,
        [[page.getByLabel('Adres e-mail'), `e2e-nobody-${STAMP}@example.test`]],
        'Wyślij link',
      );
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
