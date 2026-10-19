import { apiReadiness, webVersion, type Health } from '@/lib/health';

/**
 * Health of the API and its database, seen through the web app: the API has no public
 * address. 200 when the API answers that it is ready, 503 otherwise. Used by people and
 * monitoring, not by the probes of the web app.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { ready, version } = await apiReadiness(process.env.API_INTERNAL_URL);
  const body: Health = ready
    ? { status: 'ok', version: webVersion(), api: version ?? 'unknown' }
    : { status: 'unavailable', version: webVersion() };
  return Response.json(body, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
