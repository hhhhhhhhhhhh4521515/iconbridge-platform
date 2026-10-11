'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  attempt,
  type CandidateDocument,
  type Profile,
  type SessionUser,
} from '@/lib/client-api';

interface AccountData {
  user: SessionUser;
  profile: Profile;
  documents: CandidateDocument[];
}

interface Account extends AccountData {
  setProfile: (profile: Profile) => void;
  /** Reads the profile and the documents again, e.g. after an upload changed the completeness. */
  reload: () => Promise<void>;
}

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  /** Signed in, but not as a candidate: the back office has its own pages. */
  | { status: 'staff' }
  | { status: 'ready'; data: AccountData };

const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const account = useContext(AccountContext);
  if (!account) {
    throw new Error('useAccount is used outside the account area');
  }
  return account;
}

async function load(): Promise<State> {
  // The profile comes first: if the access token has expired, this call renews the session.
  const profile = await attempt(api.GET('/api/v1/me/profile'));
  if (profile.response?.status === 403) {
    return { status: 'staff' };
  }
  if (!profile.data) {
    return { status: 'failed' };
  }
  const [session, documents] = await Promise.all([
    attempt(api.GET('/api/v1/auth/session')),
    attempt(api.GET('/api/v1/me/documents')),
  ]);
  if (!session.data?.user || !documents.data) {
    return { status: 'failed' };
  }
  return {
    status: 'ready',
    data: { user: session.data.user, profile: profile.data, documents: documents.data },
  };
}

export function AccountProvider({
  children,
  loading,
  failed,
  staff,
}: {
  children: ReactNode;
  loading: ReactNode;
  failed: (retry: () => void) => ReactNode;
  staff: ReactNode;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const reload = useCallback(async () => {
    setState(await load());
  }, []);
  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setProfile = useCallback((profile: Profile) => {
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', data: { ...current.data, profile } }
        : current,
    );
  }, []);
  const data = state.status === 'ready' ? state.data : null;
  const account = useMemo(
    () => (data ? { ...data, setProfile, reload } : null),
    [data, setProfile, reload],
  );

  if (!account) {
    if (state.status === 'staff') {
      return staff;
    }
    return state.status === 'failed'
      ? failed(() => {
          setState({ status: 'loading' });
          void reload();
        })
      : loading;
  }
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

/** Loads something once the page is shown, and again when `reload` is called. */
export function useLoaded<T>(fetcher: () => Promise<T | undefined>): {
  data: T | undefined;
  failed: boolean;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
} {
  const [state, setState] = useState<{ data?: T; failed: boolean; loading: boolean }>({
    failed: false,
    loading: true,
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetcher()
      .catch(() => undefined)
      .then((data) => {
        if (!cancelled) {
          setState({ data, failed: data === undefined, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, version]);
  const reload = useCallback(() => {
    setState((current) => ({ ...current, failed: false, loading: true }));
    setVersion((value) => value + 1);
  }, []);
  const setData = useCallback((data: T) => {
    setState({ data, failed: false, loading: false });
  }, []);
  return { data: state.data, failed: state.failed, loading: state.loading, reload, setData };
}
