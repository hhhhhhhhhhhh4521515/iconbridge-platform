import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { pickCountry, verifiedCandidate } from './support';

/** Chooses a date in the order the English page shows the lists: month, day, year. */
async function pickMonthDayYear(page: Page, label: RegExp, date: string): Promise<void> {
  const [year = '', month = '', day = ''] = date.split('-');
  const group = page.getByRole('group', { name: label });
  await group.getByLabel('Month').selectOption(String(Number(month)));
  await group.getByLabel('Day').selectOption(String(Number(day)));
  await group.getByLabel('Year').selectOption(year);
}

const options = (page: Page) =>
  page.getByRole('listbox').filter({ visible: true }).getByRole('option');

test.describe('profile wizard', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }, testInfo) => {
    const tag = `-wizard-${testInfo.project.name}-${String(testInfo.workerIndex)}`;
    ({ context } = await verifiedCandidate(browser, tag));
    page = await context.newPage();
  });
  test.afterEach(async () => {
    await context.close();
  });

  test('passport step: the values of the production report are saved', async () => {
    // Number U488799, issued by Tunisia, both dates chosen month, day, year (bug of 15 October).
    await page.goto('/en/account/profile?step=passport');
    const message = page.getByText('Fill in every passport field, or leave them all empty.');
    await page.getByLabel(/^Passport number/).fill('U488799');
    await page.getByLabel(/^Passport number/).press('Tab');
    // The other fields are still empty: the rule is shown at once...
    await expect(message).toBeVisible();
    await pickCountry(page, /^Issued by/, 'Tun', 'Tunisia');
    await pickMonthDayYear(page, /^Issue date/, '2021-03-10');
    await pickMonthDayYear(page, /^Expiry date/, '2031-03-09');
    // ...and goes as soon as the last field is filled in, before "Save" is pressed.
    await expect(message).toHaveCount(0);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page).toHaveURL(/step=experience/);

    await page.goto('/en/account/profile?step=passport');
    await expect(page.getByLabel(/^Passport number/)).toHaveValue('U488799');
    await expect(page.getByRole('combobox', { name: /^Issued by/ })).toHaveValue('Tunisia');
  });

  test('country fields: found by typing a name or an ISO code, most used countries first', async () => {
    await page.goto('/en/account/profile?step=identity');
    const nationality = page.getByRole('combobox', { name: /^Nationality/ });

    // Opened without typing: Tunisia, Morocco, Algeria, Egypt, Malta, Poland, then A to Z.
    await nationality.click();
    await expect(nationality).toHaveAttribute('aria-expanded', 'true');
    // The second span of an option is the name (the first is the flag).
    const names = await options(page).evaluateAll((items) =>
      items.map((item) => item.querySelector('span:nth-of-type(2)')?.textContent ?? ''),
    );
    expect(names.slice(0, 6)).toEqual([
      'Tunisia',
      'Morocco',
      'Algeria',
      'Egypt',
      'Malta',
      'Poland',
    ]);
    expect(names.length).toBeGreaterThan(200);

    // Letters find the country; the flag is not part of what is searched.
    await nationality.fill('tuni');
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText('Tunisia');
    // The ISO code too.
    await nationality.fill('mt');
    await expect(options(page).first()).toContainText('Malta');
    await page.keyboard.press('Enter');
    await expect(nationality).toHaveValue('Malta');
    await expect(nationality).toHaveAttribute('aria-expanded', 'false');

    // Keyboard only: arrows move through the list, Enter chooses, Escape gives up.
    const residence = page.getByRole('combobox', { name: /^Country of residence/ });
    await residence.fill('po');
    await page.keyboard.press('ArrowDown');
    await expect(residence).toHaveAttribute('aria-activedescendant', /-option-/);
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(residence).toHaveValue('Poland');
    await residence.fill('xyz');
    await expect(options(page).first()).toContainText('No country matches');
    await page.keyboard.press('Escape');
    await expect(residence).toHaveValue('Poland');

    // The phone country, by its calling code.
    await page.getByRole('combobox', { name: 'Country calling code' }).first().fill('+356');
    await options(page).filter({ hasText: 'Malta' }).click();
    await expect(page.getByTestId('phone-country')).toHaveValue('MT');
  });

  test('country fields in French, accents ignored, and in Arabic, right to left', async () => {
    await page.goto('/fr/account/profile?step=identity');
    const nationality = page.getByRole('combobox', { name: /^Nationalité/ });
    await nationality.fill('algé');
    await expect(options(page).first()).toContainText('Algérie');
    await nationality.fill('egypte');
    await expect(options(page).first()).toContainText('Égypte');

    await page.goto('/ar/account/profile?step=identity');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const residence = page.getByRole('combobox', { name: /^بلد الإقامة/ });
    await residence.fill('تون');
    await expect(options(page).first()).toContainText('تونس');
    // The list stays inside the screen (no sideways scrolling, also on a phone).
    const list = page.getByRole('listbox').filter({ visible: true });
    const box = await list.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box && box.x >= 0 && box.x + box.width <= width + 1).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await options(page).first().click();
    await expect(residence).toHaveValue('تونس');
  });
});
