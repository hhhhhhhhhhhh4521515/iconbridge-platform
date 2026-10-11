import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

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

export default function proxy(request: NextRequest): NextResponse {
  return request.nextUrl.pathname.startsWith(API_PREFIX)
    ? proxyToApi(request)
    : handleI18n(request);
}

export const config = {
  // API calls, and every page; not Next internals nor files with an extension (images, sitemap.xml...).
  matcher: ['/api/v1/:path*', '/((?!api|_next|_vercel|.*\\..*).*)'],
};
