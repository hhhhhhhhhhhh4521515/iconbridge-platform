'use client';

import { Check, Copy, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api, hasSession, refreshSession } from '@/lib/client-api';
import { cta } from '@/lib/ui';

export interface ApplyLabels {
  apply: string;
  checking: string;
  login: string;
  register: string;
  verifyEmail: string;
  completeProfile: string;
  passportExpired: string;
  /** Contains "{applied}" and "{next}". */
  cooldown: string;
  viewApplication: string;
  notOpen: string;
  maxActive: string;
  staff: string;
}

type ApplyState =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'staff' }
  | { kind: 'eligible' }
  | { kind: 'cooldown'; applied: string; next: string }
  | {
      kind: 'blocked';
      reason: 'verifyEmail' | 'completeProfile' | 'passportExpired' | 'notOpen' | 'maxActive';
    };

const REASONS = {
  EMAIL_NOT_VERIFIED: 'verifyEmail',
  PROFILE_INCOMPLETE: 'completeProfile',
  PASSPORT_EXPIRED: 'passportExpired',
  JOB_NOT_OPEN: 'notOpen',
  MAX_ACTIVE_APPLICATIONS: 'maxActive',
} as const;

/**
 * The Apply button. Its state comes from the API (GET /jobs/:id/eligibility), the
 * same rule the API applies when the candidate really applies:
 * not signed in -> "Login to apply"; waiting period -> "You can apply again on <date>"
 * with a link to the application; otherwise the reason that blocks, or "Apply now".
 */
export function ApplyButton({
  jobId,
  slug,
  locale,
  labels,
}: {
  jobId: string;
  slug: string;
  locale: string;
  labels: ApplyLabels;
}) {
  const [state, setState] = useState<ApplyState>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    const date = (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso));
    const load = async (): Promise<ApplyState> => {
      // /auth/session answers 200 to visitors too, so no failed request shows in the console.
      let session = await api.GET('/api/v1/auth/session');
      if (!session.data?.user && hasSession() && (await refreshSession())) {
        // The access token had expired (it lives 15 minutes); the session itself was still good.
        session = await api.GET('/api/v1/auth/session');
      }
      const user = session.data?.user;
      if (!user) {
        return { kind: 'anonymous' };
      }
      if (user.role !== 'CANDIDATE') {
        return { kind: 'staff' };
      }
      const { data } = await api.GET('/api/v1/jobs/{id}/eligibility', {
        params: { path: { id: jobId } },
      });
      if (!data) {
        return { kind: 'blocked', reason: 'notOpen' };
      }
      if (data.canApply) {
        return { kind: 'eligible' };
      }
      if (data.reasons.includes('REAPPLY_COOLDOWN') && data.lastAppliedAt && data.nextAllowedAt) {
        return {
          kind: 'cooldown',
          applied: date(data.lastAppliedAt),
          next: date(data.nextAllowedAt),
        };
      }
      const reason = data.reasons.find((code) => code !== 'REAPPLY_COOLDOWN');
      return { kind: 'blocked', reason: reason ? REASONS[reason] : 'notOpen' };
    };
    load()
      .catch((): ApplyState => ({ kind: 'anonymous' }))
      .then((next) => {
        if (!cancelled) {
          setState(next);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, locale]);

  const note = 'rounded-lg bg-muted p-3 text-sm font-medium text-foreground';
  switch (state.kind) {
    case 'checking':
      return (
        <button type="button" className={`${cta.primary} w-full`} disabled aria-busy="true">
          {labels.checking}
        </button>
      );
    case 'anonymous':
      return (
        <div className="flex flex-col gap-2" data-testid="apply-anonymous">
          <Link
            href={`/login?next=${encodeURIComponent(`/jobs/${slug}`)}`}
            className={`${cta.primary} w-full`}
          >
            {labels.login}
          </Link>
          <Link href="/register" className={`${cta.outline} w-full`}>
            {labels.register}
          </Link>
        </div>
      );
    case 'staff':
      return <p className={note}>{labels.staff}</p>;
    case 'eligible':
      return (
        <Link href={`/account/apply/${slug}`} className={`${cta.primary} w-full`}>
          {labels.apply}
        </Link>
      );
    case 'cooldown':
      return (
        <div className="flex flex-col gap-2" data-testid="apply-cooldown">
          <p className={note} role="status">
            {labels.cooldown.replace('{applied}', state.applied).replace('{next}', state.next)}
          </p>
          <Link href="/account/applications" className={`${cta.outline} w-full`}>
            {labels.viewApplication}
          </Link>
        </div>
      );
    case 'blocked':
      return (
        <div className="flex flex-col gap-2">
          <p className={note} role="status">
            {labels[state.reason]}
          </p>
          {state.reason === 'completeProfile' || state.reason === 'passportExpired' ? (
            <Link href="/account/profile" className={`${cta.outline} w-full`}>
              {labels[state.reason]}
            </Link>
          ) : null}
        </div>
      );
  }
}

/** Time left before the deadline, refreshed every minute. Rendered after mount: it depends on the visitor's clock. */
export function DeadlineCountdown({
  deadline,
  locale,
  closedLabel,
}: {
  deadline: string;
  locale: string;
  closedLabel: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  if (now === null) {
    return null;
  }
  const left = new Date(deadline).getTime() - now;
  if (left <= 0) {
    return <p className="text-sm font-semibold text-destructive">{closedLabel}</p>;
  }
  const minutes = Math.floor(left / 60_000);
  const [value, unit] =
    minutes >= 2880
      ? ([Math.floor(minutes / 1440), 'day'] as const)
      : minutes >= 120
        ? ([Math.floor(minutes / 60), 'hour'] as const)
        : ([Math.max(1, minutes), 'minute'] as const);
  // "in 12 days", "dans 12 jours", "خلال 12 يومًا": written by the browser in the page language.
  const text = new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(value, unit);
  return (
    <p
      className="text-sm font-semibold text-brand-blue dark:text-brand-gold"
      role="timer"
      data-testid="countdown"
    >
      {text}
    </p>
  );
}

export interface ShareLabels {
  title: string;
  copy: string;
  copied: string;
  /** Contains "{network}". */
  shareOn: string;
  email: string;
}

export function ShareButtons({
  url,
  title,
  labels,
}: {
  url: string;
  title: string;
  labels: ShareLabels;
}) {
  const [copied, setCopied] = useState(false);
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  // Brand logos are not part of the icon set: each network is shown by a short text mark.
  const networks = [
    { name: 'WhatsApp', mark: 'WA', href: `https://wa.me/?text=${encodedTitle}%20${encodedUrl}` },
    {
      name: 'Facebook',
      mark: 'f',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      name: 'LinkedIn',
      mark: 'in',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
  ];
  const button =
    'inline-flex size-11 items-center justify-center rounded-full border border-input bg-background text-foreground hover:bg-muted';
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">{labels.title}</h2>
      <ul className="flex flex-wrap gap-2">
        {networks.map((network) => (
          <li key={network.name}>
            <a href={network.href} target="_blank" rel="noopener noreferrer" className={button}>
              <span aria-hidden className="text-sm font-bold">
                {network.mark}
              </span>
              <span className="sr-only">{labels.shareOn.replace('{network}', network.name)}</span>
            </a>
          </li>
        ))}
        <li>
          <a
            href={`mailto:?subject=${encodedTitle}&body=${encodedUrl}`}
            className={button}
            aria-label={labels.email}
          >
            <Mail className="size-5" aria-hidden />
          </a>
        </li>
        <li>
          <button
            type="button"
            className={button}
            aria-label={copied ? labels.copied : labels.copy}
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                window.setTimeout(() => {
                  setCopied(false);
                }, 2500);
              });
            }}
          >
            {copied ? (
              <Check className="size-5" aria-hidden />
            ) : (
              <Copy className="size-5" aria-hidden />
            )}
          </button>
        </li>
      </ul>
      <p className="sr-only" aria-live="polite">
        {copied ? labels.copied : ''}
      </p>
    </div>
  );
}
