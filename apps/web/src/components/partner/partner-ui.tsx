'use client';

import { History, KeyRound, LayoutGrid, LogOut, type LucideIcon } from 'lucide-react';
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

export const heading = 'text-lg font-semibold tracking-tight';
/** The partner area's card: the site's radius, a soft shadow, one padding scale. */
export const card =
  'rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm md:p-6';
/** A card that is a link or holds one: it rises on hover. */
export const cardHover = 'transition-shadow hover:shadow-md hover:border-foreground/20';

/** Work permit statuses, in the order of the process (ADR-027, amendment 1). */
export const WORK_PERMIT_STATUSES = ['NOT_STARTED', 'SUBMITTED', 'APPROVED', 'REFUSED'] as const;
export type WorkPermitStatus = (typeof WORK_PERMIT_STATUSES)[number];
export const VISA_STATUSES = [
  'NOT_STARTED',
  'APPOINTMENT_BOOKED',
  'SUBMITTED',
  'APPROVED',
  'REFUSED',
] as const;
export type VisaStatus = (typeof VISA_STATUSES)[number];

/**
 * The four tones of a status: grey not started, blue under way, green done, red refused.
 * Each pair has 4.5:1 contrast at least in light and dark mode (checked by axe); the text
 * carries the meaning, the colour and the dot only help.
 */
export type Tone = 'grey' | 'blue' | 'green' | 'red';
const TONES: Record<Tone, { badge: string; dot: string }> = {
  grey: { badge: 'bg-muted text-foreground', dot: 'bg-muted-foreground' },
  blue: {
    badge: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
    dot: 'bg-blue-600 dark:bg-blue-400',
  },
  green: {
    badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
  },
  red: {
    badge: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
    dot: 'bg-red-600 dark:bg-red-400',
  },
};

export const toneOf = (status: string): Tone =>
  status === 'APPROVED'
    ? 'green'
    : status === 'REFUSED'
      ? 'red'
      : status === 'NOT_STARTED'
        ? 'grey'
        : 'blue';

export function Badge({
  tone,
  children,
  testId,
  status,
}: {
  tone: Tone;
  children: ReactNode;
  testId?: string;
  status?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-status={status}
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone].badge}`}
    >
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONES[tone].dot}`} />
      {children}
    </span>
  );
}

/** A work permit status as a badge. */
export function WorkPermitBadge({ status }: { status: WorkPermitStatus }) {
  const t = useTranslations('partner.workPermit');
  return (
    <Badge tone={toneOf(status)} testId="work-permit-badge" status={status}>
      {t(status)}
    </Badge>
  );
}

/** A visa status as a badge. */
export function VisaBadge({ status }: { status: VisaStatus }) {
  const t = useTranslations('partner.visa');
  return (
    <Badge tone={toneOf(status)} testId="visa-badge" status={status}>
      {t(status)}
    </Badge>
  );
}

/** Open or closed, for a job demand. */
export function JobStatusBadge({ status }: { status: 'OPEN' | 'CLOSED' }) {
  const t = useTranslations('partner.home');
  return (
    <Badge tone={status === 'OPEN' ? 'green' : 'grey'} testId="job-status" status={status}>
      {status === 'OPEN' ? t('open') : t('closed')}
    </Badge>
  );
}

/** Initials of a name in a circle; decorative, the name is always written next to it. */
export function Avatar({
  name,
  size = 'md',
  onDark = false,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** On a navy background: gold, so the circle stays visible. */
  onDark?: boolean;
}) {
  const initials =
    name
      .split(/[\s@.-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';
  const sizes = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' };
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${
        onDark
          ? 'bg-brand-gold text-brand-navy'
          : 'bg-brand-navy text-white dark:bg-brand-gold dark:text-brand-navy'
      } ${sizes[size]}`}
    >
      {initials}
    </span>
  );
}

/** An icon in a tinted square, for the cards' titles. */
export function IconTile({ icon: Icon, tone = 'navy' }: { icon: LucideIcon; tone?: string }) {
  const tones: Record<string, string> = {
    navy: 'bg-brand-navy/10 text-brand-navy dark:bg-white/10 dark:text-white',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    gold: 'bg-brand-gold-soft text-brand-navy dark:text-brand-gold',
  };
  return (
    <span
      aria-hidden
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${tones[tone] ?? tones.navy}`}
    >
      <Icon className="size-5" />
    </span>
  );
}

/** The title of a card, with its icon. */
export function CardTitle({
  icon,
  id,
  children,
  as: Tag = 'h2',
}: {
  icon: LucideIcon;
  id?: string;
  children: ReactNode;
  as?: 'h2' | 'h3' | 'span';
}) {
  return (
    <Tag id={id} className={`${heading} flex items-center gap-3`}>
      <IconTile icon={icon} />
      {children}
    </Tag>
  );
}

/** A grey block that stands for content still loading; same size, so nothing moves. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-lg bg-muted ${className}`} />;
}

/** Nothing here yet: an icon, one sentence and, often, the next step. */
export function EmptyState({
  icon: Icon,
  text,
  action,
  testId,
}: {
  icon: LucideIcon;
  text: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-12 text-center"
    >
      <span
        aria-hidden
        className="inline-flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-7" />
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
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

/**
 * A screen or a part still loading: grey blocks in the shape of the content, and the word
 * for screen readers; `variant` gives the shape.
 */
export function LoadingText({ variant = 'block' }: { variant?: 'block' | 'page' | 'cards' }) {
  const t = useTranslations('partner.ui');
  return (
    <div role="status" className="w-full" data-testid="loading">
      <span className="sr-only">{t('loading')}</span>
      {variant === 'page' ? (
        <div className="space-y-6">
          <Skeleton className="h-8 w-64 max-w-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : variant === 'cards' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-56" />
          ))}
        </div>
      ) : (
        <div className="space-y-3 py-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
    </div>
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
  country: string;
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
        {
          href: home,
          label: t('jobs'),
          icon: LayoutGrid,
          current: !pathname.endsWith('/history'),
        },
        {
          href: partnerHref(lang, `/spaces/${space.id}/history`),
          label: t('history'),
          icon: History,
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
        <nav aria-label={t('menu')} className="flex items-center gap-0.5 sm:gap-1">
          {menu.map((item) => (
            <NextLink
              key={item.href}
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={`${cta.ghost} px-2.5! aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground sm:px-3!`}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </NextLink>
          ))}
          <NextLink
            href={partnerHref(lang, '/password')}
            className={`${cta.ghost} px-2.5! sm:px-3!`}
          >
            <KeyRound className="size-4" aria-hidden />
            <span className="hidden md:inline">{t('changePassword')}</span>
            <span className="sr-only md:hidden">{t('changePassword')}</span>
          </NextLink>
          <button
            type="button"
            className={`${cta.ghost} px-2.5! sm:px-3!`}
            onClick={() => void logout()}
          >
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
      <main id="main" className="container-page w-full flex-1 py-8 md:py-10">
        {content}
      </main>
      {/* Above the bar that saves an application (about 4.5 rem high), never over its buttons. */}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        offset={{ bottom: '6rem', right: '1.5rem' }}
        mobileOffset={{ bottom: '6rem' }}
      />
    </>
  );

  if (state.status === 'loading') {
    return main(<LoadingText variant="page" />);
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
            <LoadingText variant="page" />
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
