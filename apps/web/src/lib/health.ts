import { readinessSchema } from '@iconbridge/shared/schemas';

/**
 * What the health routes answer: the status, and the commit each app runs (APP_VERSION,
 * set by the Dockerfiles from VCS_REF; "dev" outside an image). The deployment waits until
 * both versions are the commit it deployed. Nothing else: no detail about the API.
 */
export type Health =
  { status: 'ok'; version: string; api: string } | { status: 'unavailable'; version: string };

/** The commit the web app was built from. */
export function webVersion(env: Record<string, string | undefined> = process.env): string {
  return env['APP_VERSION'] || 'dev';
}

/**
 * Asks the API whether it is ready (its database answers), and which commit it runs.
 * The API has no public address in Azure; this is how its health is checked through the
 * web app.
 */
export async function apiReadiness(
  apiBaseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<{ ready: boolean; version?: string }> {
  if (!apiBaseUrl) {
    return { ready: false };
  }
  try {
    const response = await fetcher(new URL('/health/ready', apiBaseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ready: false };
    }
    // An API image older than 19 October 2026 answers without a version.
    const body = readinessSchema.safeParse(await response.json().catch(() => null));
    return body.success ? { ready: true, version: body.data.version } : { ready: true };
  } catch {
    return { ready: false };
  }
}
