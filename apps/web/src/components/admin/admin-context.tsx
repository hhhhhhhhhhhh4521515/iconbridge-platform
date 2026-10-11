'use client';

import { hasPermission, type Permission } from '@iconbridge/shared/permissions';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  attempt,
  goToLogin,
  hasSession,
  refreshSession,
  type SessionUser,
} from '@/lib/client-api';

interface Admin {
  user: SessionUser;
  /** What the menus and buttons show. The API decides again on every call. */
  can: (permission: Permission) => boolean;
  /**
   * Deleting candidates and applications: a super admin, or a recruiter when the
   * setting allows it. Told by the API, which checks again on every deletion.
   */
  canDelete: boolean;
}

const AdminContext = createContext<Admin | null>(null);

export function useAdmin(): Admin {
  const admin = useContext(AdminContext);
  if (!admin) {
    throw new Error('useAdmin is used outside the back office');
  }
  return admin;
}

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'forbidden' }
  | { status: 'ready'; user: SessionUser; canDelete: boolean };

async function load(): Promise<State> {
  let session = await attempt(api.GET('/api/v1/auth/session'));
  if (session.data && !session.data.user && hasSession() && (await refreshSession())) {
    // The access token had expired; the session itself was still good.
    session = await attempt(api.GET('/api/v1/auth/session'));
  }
  if (!session.data) {
    return { status: 'failed' };
  }
  const user = session.data.user;
  if (!user) {
    goToLogin();
    return { status: 'loading' };
  }
  if (user.role === 'CANDIDATE') {
    return { status: 'forbidden' };
  }
  const capabilities = await attempt(api.GET('/api/v1/admin/capabilities'));
  return { status: 'ready', user, canDelete: capabilities.data?.canDeleteRecords ?? false };
}

export function AdminProvider({
  children,
  loading,
  failed,
  forbidden,
}: {
  children: ReactNode;
  loading: ReactNode;
  failed: ReactNode;
  forbidden: ReactNode;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
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
  const user = state.status === 'ready' ? state.user : null;
  const canDelete = state.status === 'ready' && state.canDelete;
  const admin = useMemo(
    () =>
      user
        ? {
            user,
            can: (permission: Permission) => hasPermission(user.role, permission),
            canDelete,
          }
        : null,
    [user, canDelete],
  );
  if (!admin) {
    return state.status === 'forbidden' ? forbidden : state.status === 'failed' ? failed : loading;
  }
  return <AdminContext.Provider value={admin}>{children}</AdminContext.Provider>;
}
