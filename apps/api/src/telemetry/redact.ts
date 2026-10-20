/**
 * Attributes of HTTP spans that hold a URL or its query string. Query strings can carry
 * one-time tokens and search text typed by a person: telemetry keeps the path only.
 */
export const URL_ATTRIBUTES = ['url.full', 'url.query', 'http.url', 'http.target'] as const;

/** The URL without its query string ("url.query" becomes empty). */
export function withoutQuery(key: string, value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (key === 'url.query') {
    return '';
  }
  const index = value.indexOf('?');
  return index === -1 ? value : value.slice(0, index);
}

/** Health probes (every 1 to 30 seconds per replica) are not telemetry: they would fill the daily cap. */
export function isProbe(path: string | undefined): boolean {
  return path !== undefined && /^\/(api\/)?health(\/|$)/.test(path);
}
