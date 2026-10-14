import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** axe and the Content-Security-Policy, checked the same way on every page. */

export const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** What axe found, short enough to read in the report of a failed test. */
export async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${String(violation.impact)}): ${violation.help}\n` +
      violation.nodes
        .slice(0, 5)
        .map((node) => `    ${node.target.join(' ')}  ${node.failureSummary?.split('\n')[1] ?? ''}`)
        .join('\n'),
  );
}

/** Everything the browser refused because of the Content-Security-Policy, from now on. */
export function watchCsp(page: Page): string[] {
  const refused: string[] = [];
  page.on('console', (message) => {
    if (/Content[- ]Security[- ]Policy/i.test(message.text())) {
      refused.push(message.text());
    }
  });
  return refused;
}

export async function check(page: Page, path: string): Promise<void> {
  const refused = watchCsp(page);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Animations of entry are over: a text half faded in has no contrast to measure.
  await page.waitForTimeout(600);
  // Soft: a test that visits several pages reports all of them, not the first one only.
  expect.soft(await violations(page), `axe on ${path}`).toEqual([]);
  expect.soft(refused, `refused by the Content-Security-Policy on ${path}`).toEqual([]);
}
