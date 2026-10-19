/**
 * What the web app's telemetry (Application Insights) leaves out. Query strings can carry
 * one-time tokens (email links: /verify-email?token=…); health probes run every few
 * seconds; static files are not worth a request row each.
 */
export function withoutQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const index = value.indexOf('?');
  return index === -1 ? value : value.slice(0, index);
}

export function isIgnoredPath(path: string | undefined): boolean {
  return (
    path !== undefined &&
    (/^\/api\/health(\/|$)/.test(path) || path.startsWith('/_next/') || path === '/favicon.ico')
  );
}
