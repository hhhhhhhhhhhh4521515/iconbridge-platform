import type { CookieOptions, Response } from 'express';
import { API_PREFIX } from '../app.constants.js';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_COOKIE,
  REFRESH_TOKEN_TTL_MS,
  SESSION_MARKER_COOKIE,
} from './auth.constants.js';

// httpOnly: not readable by scripts. Secure: HTTPS only (browsers also accept it on
// http://localhost). SameSite=Lax: not sent on cross-site POST, which blocks CSRF.
const BASE: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' };

const ACCESS_OPTIONS: CookieOptions = { ...BASE, path: '/' };
/** The refresh token is only ever sent to the auth endpoints. */
const REFRESH_OPTIONS: CookieOptions = { ...BASE, path: `/${API_PREFIX}/auth` };
const MARKER_OPTIONS: CookieOptions = { secure: true, sameSite: 'lax', path: '/', httpOnly: false };

export function setAuthCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
): void {
  response.cookie(ACCESS_COOKIE, accessToken, { ...ACCESS_OPTIONS, maxAge: ACCESS_TOKEN_TTL_MS });
  response.cookie(REFRESH_COOKIE, refreshToken, {
    ...REFRESH_OPTIONS,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
  response.cookie(SESSION_MARKER_COOKIE, '1', { ...MARKER_OPTIONS, maxAge: REFRESH_TOKEN_TTL_MS });
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(ACCESS_COOKIE, ACCESS_OPTIONS);
  response.clearCookie(REFRESH_COOKIE, REFRESH_OPTIONS);
  response.clearCookie(SESSION_MARKER_COOKIE, MARKER_OPTIONS);
}
