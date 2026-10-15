/**
 * Liveness and readiness probe of the web app (Container Apps). It does not call the API:
 * a probe must not keep the API awake, and a stopped API is no reason to restart the web
 * app.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
