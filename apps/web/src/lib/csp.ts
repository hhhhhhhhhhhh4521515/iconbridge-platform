/**
 * Content Security Policy of the pages. Each response gets a fresh nonce: only the
 * scripts the server put in the page with that nonce (and what they load) may run,
 * so text injected into a page cannot execute. Built in `proxy.ts`.
 */

const TURNSTILE = 'https://challenges.cloudflare.com';

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export interface CspOptions {
  /** The development server needs eval and a websocket for fast refresh and its error overlay. */
  development: boolean;
  /** The site is served over https: plain-http requests from its pages are upgraded. */
  https: boolean;
  /**
   * Origins of the file storage: pictures of the site and previews of candidate
   * documents come from there (Azure Blob Storage; Azurite locally). From CSP_MEDIA_ORIGINS.
   */
  mediaOrigins: readonly string[];
}

/** "https://a.example  http://localhost:10000" or a comma-separated list; anything that is not an origin is dropped. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .filter((origin) => /^https?:\/\/[A-Za-z0-9*.-]+(:\d+)?$/.test(origin));
}

export function contentSecurityPolicy(nonce: string, options: CspOptions): string {
  const storage = options.mediaOrigins;
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'strict-dynamic': scripts loaded by a trusted script are trusted (Next.js chunks, Turnstile).
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      TURNSTILE,
      ...(options.development ? ["'unsafe-eval'"] : []),
    ],
    // Components position themselves with inline styles (slider, charts, crop tool).
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...storage],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", TURNSTILE, ...(options.development ? ['ws:', 'wss:'] : [])],
    // Previews of candidate documents come from the private storage through short-lived links.
    'frame-src': ["'self'", TURNSTILE, ...storage],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    ...(options.https ? { 'upgrade-insecure-requests': [] } : {}),
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ');
}
