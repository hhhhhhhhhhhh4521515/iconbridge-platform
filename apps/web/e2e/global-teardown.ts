import { request } from '@playwright/test';
import { cleanUp } from './cleanup';
import { seededAdmin, signIn } from './support';

/** After every run: the database is left as the tests found it. */
export default async function globalTeardown(): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const context = await request.newContext({
    baseURL,
    ignoreHTTPSErrors: baseURL.startsWith('https://'),
  });
  try {
    const credentials = seededAdmin();
    await signIn(context, credentials.email, credentials.password);
    const problems = await cleanUp(context);
    if (problems.length > 0) {
      throw new Error(`The browser tests left records behind:\n${problems.join('\n')}`);
    }
  } finally {
    await context.dispose();
  }
}
