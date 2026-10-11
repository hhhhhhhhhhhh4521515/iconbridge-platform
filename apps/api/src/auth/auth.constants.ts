const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ACCESS_TOKEN_TTL_MS = 15 * MINUTE;
export const REFRESH_TOKEN_TTL_MS = 7 * DAY;
export const VERIFY_EMAIL_TTL_MS = 24 * HOUR;
export const RESET_PASSWORD_TTL_MS = 1 * HOUR;
export const INVITATION_TTL_MS = 72 * HOUR;

export const MAX_FAILED_LOGINS = 5;
export const ACCOUNT_LOCK_MS = 15 * MINUTE;

export const ACCESS_COOKIE = 'ib_access';
export const REFRESH_COOKIE = 'ib_refresh';
/**
 * Readable by the web app (not httpOnly) and holding no secret: it only says "a session
 * probably exists", so pages can show the right menu and redirect visitors to the login
 * page without calling the API. Access is always decided by the API from the real tokens.
 */
export const SESSION_MARKER_COOKIE = 'ib_session';
export const JWT_ISSUER = 'iconbridge-api';

/** Requests per minute and per client IP. Auth routes are stricter than the rest. */
export const RATE_LIMITS = {
  default: { ttl: MINUTE, limit: 120 },
  auth: { ttl: MINUTE, limit: 20 },
  /** Login, registration and the endpoints that send an email. */
  authSensitive: { ttl: MINUTE, limit: 5 },
} as const;

export const msToHours = (ms: number) => Math.round(ms / HOUR);
