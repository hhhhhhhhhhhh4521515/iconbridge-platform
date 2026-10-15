/** What the health routes answer. Never details: the status of the API is enough. */
export type Health = { status: 'ok' } | { status: 'unavailable' };

/**
 * Asks the API whether it is ready (its database answers). The API has no public
 * address in Azure; this is how its health is checked through the web app.
 */
export async function apiReadiness(
  apiBaseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<{ ready: boolean }> {
  if (!apiBaseUrl) {
    return { ready: false };
  }
  try {
    const response = await fetcher(new URL('/health/ready', apiBaseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ready: response.ok };
  } catch {
    return { ready: false };
  }
}
