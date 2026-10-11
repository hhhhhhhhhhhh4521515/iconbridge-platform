'use client';

import { createApiClient, type ApiPaths } from '@iconbridge/shared/api-client';

/** Set by the API next to the session cookies; readable here, and it holds no secret. */
const SESSION_MARKER = 'ib_session';
const SESSION_EVENT = 'ib:session';
const AUTH_PATH = '/api/v1/auth/';

export function hasSession(): boolean {
  return document.cookie.split('; ').some((cookie) => cookie.startsWith(`${SESSION_MARKER}=`));
}

/** For useSyncExternalStore: the header follows sign-in and sign-out without a reload. */
export function subscribeToSession(listener: () => void): () => void {
  window.addEventListener(SESSION_EVENT, listener);
  return () => {
    window.removeEventListener(SESSION_EVENT, listener);
  };
}

/** Call after a sign-in or a sign-out so every listener reads the marker again. */
export function sessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/** Removes the marker after a sign-out, or when the session turns out to be over. */
export function forgetSession(): void {
  document.cookie = `${SESSION_MARKER}=; Max-Age=0; path=/`;
  sessionChanged();
}

let refreshing: Promise<boolean> | undefined;

/** One refresh at a time: calls that fail together wait for the same new access token. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${AUTH_PATH}refresh`, { method: 'POST', credentials: 'same-origin' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

/** Sends the visitor to the login page, which brings them back here afterwards. */
export function goToLogin(): void {
  const [, locale = 'fr', ...rest] = window.location.pathname.split('/');
  const here = `/${rest.join('/')}${window.location.search}`;
  // A full page load on purpose: whatever the page held about the old session is dropped.
  window.location.replace(`/${locale}/login?next=${encodeURIComponent(here)}`);
}

const inAccountArea = () => /^\/[a-z]{2}\/(account|admin)(\/|$)/.test(window.location.pathname);

/** What to do when the session cannot be renewed. */
export function sessionLost(): void {
  forgetSession();
  if (inAccountArea()) {
    goToLogin();
  }
}

/**
 * Silent refresh: the access token lives 15 minutes. When a call answers 401, the
 * session is renewed once with the refresh cookie and the call is sent again; the
 * person notices nothing. If the session is really over, they go to the login page.
 */
async function fetchWithRefresh(request: Request): Promise<Response> {
  const again = request.clone();
  const response = await fetch(request);
  if (response.status !== 401 || new URL(request.url).pathname.startsWith(AUTH_PATH)) {
    return response;
  }
  if (await refreshSession()) {
    return fetch(again);
  }
  sessionLost();
  return response;
}

export const api = createApiClient({ fetch: fetchWithRefresh });

type Body<
  Path extends keyof ApiPaths,
  Method extends 'get' | 'put' | 'post',
> = ApiPaths[Path] extends {
  [M in Method]: { responses: infer Responses };
}
  ? Responses extends { 200: { content: { 'application/json': infer Json } } }
    ? Json
    : Responses extends { 201: { content: { 'application/json': infer Json } } }
      ? Json
      : never
  : never;

export type SessionUser = NonNullable<Body<'/api/v1/auth/session', 'get'>['user']>;
export type Profile = Body<'/api/v1/me/profile', 'get'>;
export type CandidateDocument = Body<'/api/v1/me/documents', 'get'>[number];
export type Application = Body<'/api/v1/me/applications', 'get'>[number];
export type Eligibility = Body<'/api/v1/jobs/{id}/eligibility', 'get'>;
export type Job = Body<'/api/v1/jobs/{slug}', 'get'>;
export type JobAlert = Body<'/api/v1/me/job-alerts', 'get'>[number];
export type Destination = Body<'/api/v1/destinations', 'get'>[number];
export type Category = Body<'/api/v1/categories', 'get'>[number];

// --- Back office ---
export type AdminStats = Body<'/api/v1/admin/stats', 'get'>;
export type AdminJob = Body<'/api/v1/admin/jobs/{id}', 'get'>;
export type AdminApplication = Body<'/api/v1/admin/applications', 'get'>['items'][number];
export type AdminApplicationDetail = Body<'/api/v1/admin/applications/{id}', 'get'>;
export type AdminCandidate = Body<'/api/v1/admin/candidates', 'get'>['items'][number];
export type AdminCandidateDetail = Body<'/api/v1/admin/candidates/{id}', 'get'>;
export type AdminStory = Body<'/api/v1/admin/success-stories', 'get'>[number];
export type AdminSlide = Body<'/api/v1/admin/home-slides', 'get'>[number];
export type AdminDestination = Body<'/api/v1/admin/destinations', 'get'>[number];
export type AdminCategory = Body<'/api/v1/admin/categories', 'get'>[number];
export type AdminUser = Body<'/api/v1/admin/users', 'get'>['items'][number];
export type ContactMessage = Body<'/api/v1/admin/contact-messages', 'get'>['items'][number];
export type AuditEntry = Body<'/api/v1/admin/audit-logs', 'get'>['items'][number];
export type SettingValues = Body<'/api/v1/admin/settings', 'get'>;
export type ApplicationStatus = AdminApplication['status'];
export type JobQuestion = Job['questions'][number];

export interface ApiFailure {
  code: string;
  message?: string;
  details?: unknown;
  nextAllowedAt?: string;
}

/** The error body of the API, or a generic failure when the answer is not one (network, proxy). */
export function failure(error: unknown): ApiFailure {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return error as ApiFailure;
  }
  return { code: 'INTERNAL_ERROR' };
}

/** Network errors become a result instead of an exception, like any other failed call. */
export async function attempt<T extends { error?: unknown }>(
  call: Promise<T>,
): Promise<T | { data: undefined; error: ApiFailure; response: undefined }> {
  try {
    return await call;
  } catch {
    return { data: undefined, error: { code: 'INTERNAL_ERROR' }, response: undefined };
  }
}
