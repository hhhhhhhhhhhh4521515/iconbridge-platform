import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return 'invalid';
  }
}

/**
 * Second defence against cross-site request forgery, after SameSite=Lax cookies.
 *
 * A browser sends `Origin` with every request that changes something. When that
 * origin is neither the web app nor the API itself, the request was started by
 * another site and is refused before it reaches any handler. Requests without
 * `Origin` or `Referer` do not come from a page (server-to-server calls, command-line
 * tools): they carry no ambient browser session and go on to the normal authentication.
 */
export function originCheck(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins.map((origin) => originOf(origin)));
  return (request: Request, response: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(request.method)) {
      next();
      return;
    }
    const origin = originOf(request.get('origin')) ?? originOf(request.get('referer'));
    // Same origin as the API itself: the Swagger page.
    const own = `${request.protocol}://${request.get('host') ?? ''}`;
    if (origin === null || allowed.has(origin) || origin === own) {
      next();
      return;
    }
    response.status(403).json({
      code: 'FORBIDDEN',
      message: 'This request comes from another site',
    });
  };
}
