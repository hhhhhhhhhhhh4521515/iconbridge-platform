import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { canonicalRedirectUrl } from './lib/canonical-host';
import { contentSecurityPolicy, createNonce, parseOrigins } from './lib/csp';

const handleI18n = createIntlMiddleware(routing);
const API_PREFIX = '/api/v1/';
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Same-origin API: the browser only ever calls /api/v1/* on the web origin, and
 * this proxy forwards the call to the API (API_INTERNAL_URL, read at run time).
 * The session cookies are therefore first-party (SameSite=Lax works) and no CORS
 * is involved. Cookies and Set-Cookie pass through untouched; the client address
 * and a request id are forwarded so the API can rate-limit, audit and log.
 */
function proxyToApi(request: NextRequest): NextResponse {
  const base = process.env.API_INTERNAL_URL;
  if (!base) {
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'The API address is not configured' },
      { status: 500 },
    );
  }
  const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, base);
  const headers = new Headers(request.headers);
  const incomingId = request.headers.get('x-request-id') ?? '';
  headers.set('x-request-id', REQUEST_ID.test(incomingId) ? incomingId : crypto.randomUUID());
  headers.set('x-forwarded-host', request.headers.get('host') ?? '');
  headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));
  return NextResponse.rewrite(target, { request: { headers } });
}

/** Set by the API with the session cookies; see SESSION_MARKER_COOKIE in the API. */
const SESSION_MARKER = 'ib_session';
const PRIVATE_AREA = new RegExp(`^/(${routing.locales.join('|')})/(account|admin)(/.*)?$`);
/** The back office exists in English and French; other languages open it in English. */
const ADMIN_LOCALES = ['en', 'fr'];

/**
 * The candidate area and the back office need a session. Without the marker cookie
 * the visitor goes to the login page, which sends them back afterwards. This is a
 * convenience, not the protection: every piece of data comes from the API, which
 * checks the real tokens and the role.
 */
function privateAreaRedirect(request: NextRequest): NextResponse | null {
  const match = PRIVATE_AREA.exec(request.nextUrl.pathname);
  if (!match) {
    return null;
  }
  const [, locale = routing.defaultLocale, area = 'account', rest = ''] = match;
  const url = request.nextUrl.clone();
  if (area === 'admin' && !ADMIN_LOCALES.includes(locale)) {
    url.pathname = `/en/admin${rest}`;
    return NextResponse.redirect(url);
  }
  if (request.cookies.has(SESSION_MARKER)) {
    return null;
  }
  url.pathname = `/${locale}/login`;
  url.search = `?next=${encodeURIComponent(`/${area}${rest}${request.nextUrl.search}`)}`;
  return NextResponse.redirect(url);
}

export default function proxy(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith(API_PREFIX)) {
    return proxyToApi(request);
  }
  // Pages only: /api/v1 calls of a page still open on an old address keep working, and
  // the health endpoints (outside the matcher) stay reachable on the Azure address.
  const canonical = canonicalRedirectUrl(
    process.env.NEXT_PUBLIC_SITE_URL,
    request.headers.get('host'),
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (canonical) {
    return NextResponse.redirect(canonical, 308);
  }
  const redirect = privateAreaRedirect(request);
  if (redirect) {
    return redirect;
  }
  // A page: it gets a Content Security Policy with a nonce of its own. The policy is
  // also put on the request, where Next.js reads the nonce for the scripts it writes,
  // and the layout reads `x-nonce` for the few inline scripts of the site.
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV !== 'production',
    https: (process.env.NEXT_PUBLIC_SITE_URL ?? '').startsWith('https://'),
    mediaOrigins: parseOrigins(process.env.CSP_MEDIA_ORIGINS),
  });
  request.headers.set('x-nonce', nonce);
  request.headers.set('content-security-policy', policy);
  const response = handleI18n(request);
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  // API calls, and every page; not Next internals nor files with an extension (images, sitemap.xml...).
  matcher: ['/api/v1/:path*', '/((?!api|_next|_vercel|.*\\..*).*)'],
};
