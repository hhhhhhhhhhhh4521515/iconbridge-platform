import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { assertLocalUrl } from './local-only';

/**
 * What the browser tests leave in the database is written down here, then removed
 * by `global-teardown.ts` at the end of the run, through the back-office API. A run
 * that was interrupted leaves the file: the next run cleans up for it.
 *
 * Accounts and jobs need no line: their names start with "e2e-" / "E2E " and the
 * teardown looks for them.
 */
const FILE = path.join(__dirname, '.created.jsonl');
const REASON = 'Created by the browser tests';

export type Created =
  | { kind: 'application' | 'story' | 'slide' | 'destination' | 'category' | 'message'; id: string }
  /** A visitor's job alert: every alert of the address is removed. */
  | { kind: 'alert'; email: string }
  /** A setting to put back: the value it had before the test. */
  | { kind: 'setting'; key: string; value: unknown }
  /** A historical figure to put back (`value: null` when there was none). */
  | {
      kind: 'figure';
      metric: string;
      year: number | null;
      destinationId: string | null;
      value: number | null;
      note: string | null;
    };

/** One line per record; appending is safe with several workers. */
export function remember(entry: Created): void {
  appendFileSync(FILE, `${JSON.stringify(entry)}\n`);
}

interface Page<Item> {
  items: Item[];
}
const items = async <Item>(request: APIRequestContext, url: string): Promise<Item[]> => {
  const response = await request.get(url);
  return response.ok() ? ((await response.json()) as Page<Item>).items : [];
};
const chunks = <Item>(list: Item[], size: number): Item[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, (index + 1) * size),
  );

/**
 * Removes what the tests created and puts back what they changed. `request` is
 * signed in as the super admin. Returns what could not be undone, for the report.
 */
export async function cleanUp(request: APIRequestContext, baseURL: string): Promise<string[]> {
  assertLocalUrl(baseURL, 'The clean-up of the browser tests');
  const problems: string[] = [];
  const check = async (what: string, response: Promise<{ status(): number }>) => {
    const status = (await response).status();
    // 404: already removed by the test itself.
    if (status >= 400 && status !== 404) {
      problems.push(`${what}: ${String(status)}`);
    }
  };
  const created: Created[] = existsSync(FILE)
    ? readFileSync(FILE, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Created)
    : [];
  const ids = (kind: Created['kind']) =>
    created.flatMap((entry) => (entry.kind === kind && 'id' in entry ? [entry.id] : []));

  // Settings and figures first: the value before the first test that touched them.
  const settings = new Map<string, unknown>();
  for (const entry of created) {
    if (entry.kind === 'setting' && !settings.has(entry.key)) {
      settings.set(entry.key, entry.value);
    }
  }
  for (const [key, value] of settings) {
    await check(
      `setting ${key}`,
      request.put(`/api/v1/admin/settings/${key}`, { data: { value } }),
    );
  }
  const figures = new Map<string, Extract<Created, { kind: 'figure' }>>();
  for (const entry of created) {
    if (entry.kind === 'figure') {
      const key = `${entry.metric}/${String(entry.year)}/${String(entry.destinationId)}`;
      if (!figures.has(key)) {
        figures.set(key, entry);
      }
    }
  }
  if (figures.size > 0) {
    const current = (await (await request.get('/api/v1/admin/historical-figures')).json()) as {
      id: string;
      metric: string;
      year: number | null;
      destinationId: string | null;
    }[];
    for (const figure of figures.values()) {
      const { value } = figure;
      const where = {
        metric: figure.metric,
        year: figure.year,
        destinationId: figure.destinationId,
        note: figure.note,
      };
      if (value !== null) {
        await check(
          `figure ${figure.metric}`,
          request.put('/api/v1/admin/historical-figures', { data: { ...where, value } }),
        );
        continue;
      }
      const row = current.find(
        (entry) =>
          entry.metric === figure.metric &&
          entry.year === figure.year &&
          entry.destinationId === figure.destinationId,
      );
      if (row) {
        await check(
          `figure ${figure.metric}`,
          request.delete(`/api/v1/admin/historical-figures/${row.id}`),
        );
      }
    }
  }

  // Applications before candidates: deleting a candidate keeps them as anonymous rows.
  const applications = new Set(ids('application'));
  for (const application of await items<{ id: string }>(
    request,
    '/api/v1/admin/applications?q=e2e-&pageSize=100',
  )) {
    applications.add(application.id);
  }
  // Live ones, and those a test already put in the bin: both are removed for good.
  const jobs = [
    ...(await items<{ id: string; slug: string }>(
      request,
      '/api/v1/admin/jobs?q=E2E&pageSize=100',
    )),
    ...(await items<{ id: string; slug: string }>(
      request,
      '/api/v1/admin/jobs?q=E2E&deleted=true&pageSize=100',
    )),
  ].filter((job) => job.slug.startsWith('e2e-'));
  for (const job of jobs) {
    for (const application of await items<{ id: string }>(
      request,
      `/api/v1/admin/applications?jobId=${job.id}&pageSize=100`,
    )) {
      applications.add(application.id);
    }
  }
  for (const group of chunks([...applications], 50)) {
    await check(
      'applications',
      request.post('/api/v1/admin/applications/bulk-delete', {
        data: { ids: group, reason: REASON },
      }),
    );
  }
  const candidates = await items<{ id: string }>(
    request,
    '/api/v1/admin/candidates?q=e2e-&pageSize=100',
  );
  for (const group of chunks(
    candidates.map((candidate) => candidate.id),
    50,
  )) {
    await check(
      'candidates',
      request.post('/api/v1/admin/candidates/bulk-delete', {
        data: { ids: group, reason: REASON },
      }),
    );
  }
  for (const user of await items<{ id: string; email: string }>(
    request,
    '/api/v1/admin/users?pageSize=100',
  )) {
    if (user.email.startsWith('e2e-')) {
      await check(`user ${user.id}`, request.delete(`/api/v1/admin/users/${user.id}`));
    }
  }
  for (const id of ids('story')) {
    await check(`story ${id}`, request.delete(`/api/v1/admin/success-stories/${id}`));
  }
  for (const job of jobs) {
    await check(`job ${job.id}`, request.delete(`/api/v1/admin/jobs/${job.id}`));
    await check(`job ${job.id}`, request.delete(`/api/v1/admin/jobs/${job.id}?permanent=true`));
  }
  for (const [kind, route] of [
    ['slide', 'home-slides'],
    ['category', 'categories'],
    ['destination', 'destinations'],
    ['message', 'contact-messages'],
  ] as const) {
    for (const id of ids(kind)) {
      await check(`${kind} ${id}`, request.delete(`/api/v1/admin/${route}/${id}`));
    }
  }
  for (const entry of created) {
    if (entry.kind === 'alert') {
      await check(
        'job alert',
        request.post('/api/v1/admin/job-alerts/erase', { data: { email: entry.email } }),
      );
    }
  }
  if (problems.length === 0) {
    rmSync(FILE, { force: true });
  }
  return problems;
}
