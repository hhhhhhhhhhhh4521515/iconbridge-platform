'use client';

import { useSyncExternalStore } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { api, attempt, forgetSession, hasSession, subscribeToSession } from '@/lib/client-api';
import { cta } from '@/lib/ui';

export interface AuthLabels {
  jobSeeker: string;
  login: string;
  account: string;
  logout: string;
}

/** Signs out everywhere: the API ends the session and clears the cookies. */
export function useLogout(): () => Promise<void> {
  const router = useRouter();
  return async () => {
    await attempt(api.POST('/api/v1/auth/logout'));
    forgetSession();
    router.replace('/');
    router.refresh();
  };
}

/**
 * The two buttons at the end of the header. Pages are cached for everyone, so the
 * server always renders the visitor version; the browser swaps it when a session exists.
 */
export function AuthActions({ labels }: { labels: AuthLabels }) {
  const signedIn = useSyncExternalStore(subscribeToSession, hasSession, () => false);
  const logout = useLogout();
  if (signedIn) {
    return (
      <>
        <Link href="/account" className={`${cta.gold} whitespace-nowrap`}>
          {labels.account}
        </Link>
        <button
          type="button"
          className={`${cta.outline} whitespace-nowrap`}
          onClick={() => void logout()}
        >
          {labels.logout}
        </button>
      </>
    );
  }
  return (
    <>
      <Link href="/register" className={`${cta.gold} whitespace-nowrap`}>
        {labels.jobSeeker}
      </Link>
      <Link href="/login" className={`${cta.outline} whitespace-nowrap`}>
        {labels.login}
      </Link>
    </>
  );
}
