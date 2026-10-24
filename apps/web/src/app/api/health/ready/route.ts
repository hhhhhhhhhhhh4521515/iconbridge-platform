import { apiReadiness, webVersion, type Health } from '@/lib/health';

/**
 * Health of the API and its database, seen through the web app: the API has no public
 * address. 200 when the API answers that it is ready, 503 otherwise. Used by people and
 * monitoring, not by the probes of the web app.
 */
export const dynamic = 'force-dynamic';

/**
 * How long to wait for the API. It scales to zero and needs about 58 s to start
 * (ADR-017); with 5 s, the first check after a quiet period answered "unavailable"
 * although nothing was wrong. Stays under the 120 s of the availability tests.
 */
const READY_WAIT_MS = 70_000;

export async function GET(): Promise<Response> {
  const { ready, version } = await apiReadiness(process.env.API_INTERNAL_URL, fetch, READY_WAIT_MS);
  const body: Health = ready
    ? { status: 'ok', version: webVersion(), api: version ?? 'unknown' }
    : { status: 'unavailable', version: webVersion() };
  return Response.json(body, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
