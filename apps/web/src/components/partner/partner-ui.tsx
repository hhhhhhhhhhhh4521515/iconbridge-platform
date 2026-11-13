'use client';

import { KeyRound, LogOut } from 'lucide-react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { toast, Toaster } from 'sonner';
import type { z } from 'zod';
import {
  api,
  attempt,
  failure,
  forgetSession,
  goToLogin,
  hasSession,
  refreshSession,
  type SessionUser,
} from '@/lib/client-api';
import { PartnerHeader } from './partner-chrome';
import { partnerHref, type PartnerLang } from '@/lib/partner-locale';
import { cta } from '@/lib/ui';
import { ChangePassword } from './auth-forms';

export const heading = 'text-lg font-semibold';
export const card = 'rounded-xl border border-border bg-card p-4 md:p-5';

/** Work permit statuses, in the order of the process (ADR-027, amendment 1). */
export const WORK_PERMIT_STATUSES = ['NOT_STARTED', 'SUBMITTED', 'APPROVED', 'REFUSED'] as const;
export type WorkPermitStatus = (typeof WORK_PERMIT_STATUSES)[number];

/** Tones with enough contrast in light and dark mode (4.5:1 at least, checked by axe). */
const STATUS_TONES: Record<WorkPermitStatus, string> = {
  NOT_STARTED: 'bg-muted text-foreground',
  SUBMITTED: 'bg-brand-blue/15 text-brand-navy dark:bg-brand-blue/30 dark:text-white',
  APPROVED: 'bg-emerald-700 text-white',
  REFUSED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
};

/** A work permit status as a badge; the text carries the meaning, the colour only helps. */
export function WorkPermitBadge({ status }: { status: WorkPermitStatus }) {
  const t = useTranslations('partner.workPermit');
  return (
    <span
      data-testid="work-permit-badge"
      data-status={status}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_TONES[status]}`}
    >
      {t(status)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Texts of errors
// ---------------------------------------------------------------------------

/** The text of an API error code, in the partner area's language. */
export function usePartnerApiError(): (code: string | null | undefined) => string {
  const t = useTranslations('partner.api');
  return useCallback((code) => (code && t.has(code) ? t(code) : t('INTERNAL_ERROR')), [t]);
}

/** Field errors of a zod check, as texts; `custom` maps the messages of the rules between fields. */
export function useIssueTexts(): (
  issues: z.core.$ZodIssue[],
  custom?: Record<string, string>,
) => Record<string, string> {
  const t = useTranslations('partner.errors');
  return useCallback(
    (issues, custom = {}) => {
      const found: Record<string, string> = {};
      for (const issue of issues) {
        const path = String(issue.path[0] ?? '');
        if (found[path]) {
          continue;
        }
        const mapped = custom[issue.message] ?? custom[path];
        if (mapped && issue.code === 'custom') {
          found[path] = mapped;
        } else if (issue.code === 'too_small') {
          found[path] =
            issue.origin === 'string' && Number(issue.minimum) <= 1
              ? t('required')
              : issue.origin === 'string'
                ? t('tooShort', { count: Number(issue.minimum) })
                : issue.origin === 'array'
                  ? t('required')
                  : t('min', { count: Number(issue.minimum) });
        } else if (issue.code === 'too_big') {
          found[path] =
            issue.origin === 'string'
              ? t('tooLong', { count: Number(issue.maximum) })
              : issue.origin === 'array'
                ? t('tooManyPlaces')
                : t('max', { count: Number(issue.maximum) });
        } else if (issue.code === 'invalid_format' && issue.format === 'email') {
          found[path] = t('email');
        } else if (issue.code === 'invalid_format' && issue.format === 'date') {
          found[path] = t('date');
        } else if (issue.code === 'invalid_type') {
          found[path] = t('required');
        } else {
          found[path] = mapped ?? t('invalid');
        }
      }
      return found;
    },
    [t],
  );
}

type Result<T> = { ok: true; data: T } | { ok: false; code: string };

/** Runs a call of the typed client: a toast with the translated error, or the success text. */
export function usePartnerCall(): <T>(
  request: Promise<{ data?: T; error?: unknown; response?: Response }>,
  success?: string,
) => Promise<Result<T>> {
  const apiError = usePartnerApiError();
  return useCallback(
    async <T,>(
      request: Promise<{ data?: T; error?: unknown; response?: Response }>,
      success?: string,
    ): Promise<Result<T>> => {
      const outcome = await attempt(request);
      if (outcome.response?.ok) {
        if (success) {
          toast.success(success);
        }
        return { ok: true, data: outcome.data as T };
      }
      const { code } = failure(outcome.error);
      toast.error(apiError(code));
      return { ok: false, code };
    },
    [apiError],
  );
}

// ---------------------------------------------------------------------------
// Session and space
// ---------------------------------------------------------------------------

interface PartnerContextValue {
  user: SessionUser;
  lang: PartnerLang;
}

const PartnerContext = createContext<PartnerContextValue | null>(null);

export function usePartner(): PartnerContextValue {
  const value = useContext(PartnerContext);
  if (!value) {
    throw new Error('usePartner is used outside the partner area');
  }
  return value;
}

type SessionState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'refused' }
  | { status: 'ready'; user: SessionUser };

async function loadSession(): Promise<SessionState> {
  let session = await attempt(api.GET('/api/v1/auth/session'));
  if (session.data && !session.data.user && hasSession() && (await refreshSession())) {
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
  // Candidates have nothing here; staff come as members of spaces (ADR-027).
  return user.role === 'CANDIDATE' ? { status: 'refused' } : { status: 'ready', user };
}

export function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-md px-4 py-10">{children}</div>;
}

export function LoadingText() {
  const t = useTranslations('partner.ui');
  return (
    <p role="status" className="py-6 text-center text-sm text-muted-foreground">
      {t('loading')}
    </p>
  );
}

export function Failed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('forms');
  const common = useTranslations('common');
  return (
    <div role="alert" className="rounded-xl border border-border bg-card p-5 text-center">
      <p className="mb-3 text-sm font-medium">{t('loadFailed')}</p>
      <button type="button" className={cta.outline} onClick={onRetry}>
        {common('retry')}
      </button>
    </div>
  );
}

export interface SpaceSummary {
  id: string;
  name: string;
  logoUrl: string | null;
  defaultLocale: PartnerLang;
  membership: 'STAFF' | 'PARTNER';
}

const SpaceContext = createContext<SpaceSummary | null>(null);

export function useSpace(): SpaceSummary {
  const space = useContext(SpaceContext);
  if (!space) {
    throw new Error('useSpace is used outside a partner space');
  }
  return space;
}

/** Header of the partner area: the space's logo and name, its menu, language, password, sign-out. */
function Header({ space }: { space: SpaceSummary | null }) {
  const t = useTranslations('partner.header');
  const { lang } = usePartner();
  const pathname = usePathname();
  const logout = async () => {
    await attempt(api.POST('/api/v1/auth/logout'));
    forgetSession();
    // A full load: nothing of the old session stays in the page.
    window.location.assign(partnerHref(lang, '/login'));
  };
  const home = space ? partnerHref(lang, `/spaces/${space.id}`) : partnerHref(lang);
  const menu = space
    ? [
        { href: home, label: t('jobs'), current: pathname === home || pathname.includes('/jobs') },
        {
          href: partnerHref(lang, `/spaces/${space.id}/history`),
          label: t('history'),
          current: pathname.endsWith('/history'),
        },
      ]
    : [];
  return (
    <PartnerHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <NextLink href={home} className="flex min-h-11 items-center gap-3 font-semibold">
          {space?.logoUrl ? (
            // A 5-minute link to a private blob: not something next/image can optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={space.logoUrl}
              alt={t('logoAlt', { name: space.name })}
              className="h-9 w-auto max-w-32 object-contain"
            />
          ) : null}
          <span>{space ? space.name : t('mySpaces')}</span>
        </NextLink>
        <nav aria-label={t('menu')} className="flex flex-wrap items-center gap-1">
          {menu.map((item) => (
            <NextLink
              key={item.href}
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={`${cta.ghost} px-3 aria-[current=page]:bg-secondary`}
            >
              {item.label}
            </NextLink>
          ))}
          <NextLink href={partnerHref(lang, '/password')} className={`${cta.ghost} px-3`}>
            <KeyRound className="size-4" aria-hidden />
            <span className="hidden md:inline">{t('changePassword')}</span>
            <span className="sr-only md:hidden">{t('changePassword')}</span>
          </NextLink>
          <button type="button" className={`${cta.ghost} px-3`} onClick={() => void logout()}>
            <LogOut className="size-4" aria-hidden />
            <span className="hidden md:inline">{t('signOut')}</span>
            <span className="sr-only md:hidden">{t('signOut')}</span>
          </button>
        </nav>
      </div>
    </PartnerHeader>
  );
}

/**
 * Every signed-in screen of the partner area. The password chosen by a super admin is
 * replaced before anything else (ADR-024); `spaceId` loads the space for the header (404 for
 * a non-member, like the API).
 */
export function PartnerFrame({
  lang,
  spaceId,
  children,
}: {
  lang: PartnerLang;
  spaceId?: string;
  children: ReactNode;
}) {
  const t = useTranslations('partner');
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    void loadSession().then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const ready = state.status === 'ready' && !state.user.passwordChangeRequired;
  const [space, setSpace] = useState<{ id: string; value: SpaceSummary | null } | null>(null);
  useEffect(() => {
    if (!spaceId || !ready) {
      return;
    }
    let cancelled = false;
    void attempt(
      api.GET('/api/v1/partner-spaces/{spaceId}', { params: { path: { spaceId } } }),
    ).then(({ data }) => {
      if (!cancelled) {
        setSpace({ id: spaceId, value: data ?? null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, spaceId]);
  const loadedSpace = space && space.id === spaceId ? space.value : undefined;

  const main = (content: ReactNode) => (
    <>
      <main id="main" className="container-page w-full flex-1 py-6">
        {content}
      </main>
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );

  if (state.status === 'loading') {
    return main(<LoadingText />);
  }
  if (state.status === 'failed') {
    return main(
      <Failed
        onRetry={() => {
          window.location.reload();
        }}
      />,
    );
  }
  if (state.status === 'refused') {
    return main(
      <Centered>
        <div role="alert" className={`${card} text-center`}>
          <h1 className="mb-2 text-xl font-bold">{t('ui.notFoundTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('api.FORBIDDEN')}</p>
        </div>
      </Centered>,
    );
  }
  const value = { user: state.user, lang };
  if (state.user.passwordChangeRequired) {
    return (
      <PartnerContext.Provider value={value}>
        <Header space={null} />
        {main(
          <Centered>
            <ChangePassword forced />
          </Centered>,
        )}
      </PartnerContext.Provider>
    );
  }
  if (spaceId && !loadedSpace) {
    return (
      <PartnerContext.Provider value={value}>
        <Header space={null} />
        {main(
          loadedSpace === undefined ? (
            <LoadingText />
          ) : (
            <Centered>
              <div role="alert" className={`${card} text-center`} data-testid="space-not-found">
                <h1 className="mb-2 text-xl font-bold">{t('ui.notFoundTitle')}</h1>
                <p className="text-sm text-muted-foreground">{t('api.NOT_FOUND')}</p>
              </div>
            </Centered>
          ),
        )}
      </PartnerContext.Provider>
    );
  }
  const current = loadedSpace ?? null;
  return (
    <PartnerContext.Provider value={value}>
      <SpaceContext.Provider value={current}>
        <Header space={current} />
        {main(children)}
      </SpaceContext.Provider>
    </PartnerContext.Provider>
  );
}

/** Dates as the reader writes them, in the partner area's language. */
export function formatDate(iso: string | null, lang: string): string {
  if (!iso) {
    return '—';
  }
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
  );
}

export function formatDateTime(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
