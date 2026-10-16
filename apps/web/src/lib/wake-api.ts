/**
 * In Azure both apps scale to zero, and Container Apps starts the API only when a
 * request reaches it. Without this, a cold visit started the web app, waited until it
 * was ready, rendered the page, and only then woke the API: two start-ups one after
 * the other. Called once when the web server starts (instrumentation.ts), it asks the
 * API for its liveness without waiting for the answer, so both start together
 * (docs/adr/ADR-017-cold-start.md). Probes never call it: they must not keep the API awake.
 */
export function wakeApi(
  apiInternalUrl: string | undefined,
  send: typeof fetch = fetch,
): Promise<void> | undefined {
  if (!apiInternalUrl) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL('/health/live', apiInternalUrl);
  } catch {
    return undefined;
  }
  // Up to two minutes: the time the API may need to start from zero.
  return send(url, { signal: AbortSignal.timeout(120_000), cache: 'no-store' }).then(
    () => undefined,
    () => undefined,
  );
}
