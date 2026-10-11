'use client';

import {
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Settings,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { FormError, LoadFailed, Loading, Notice } from '@/components/forms/fields';
import { useLogout } from '@/components/layout/auth-actions';
import { Link, usePathname } from '@/i18n/navigation';
import { api, attempt } from '@/lib/client-api';
import { cta } from '@/lib/ui';
import { AccountProvider, useAccount } from './account-context';

const NAV: { key: string; href: string; icon: LucideIcon; exact?: boolean }[] = [
  { key: 'dashboard', href: '/account', icon: LayoutDashboard, exact: true },
  { key: 'profile', href: '/account/profile', icon: UserRound },
  { key: 'documents', href: '/account/documents', icon: FolderOpen },
  { key: 'applications', href: '/account/applications', icon: FileText },
  { key: 'settings', href: '/account/settings', icon: Settings },
];

function AccountNav() {
  const t = useTranslations('account.nav');
  const pathname = usePathname();
  const logout = useLogout();
  const item =
    'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap hover:bg-muted aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground';
  return (
    <nav aria-label={t('label')} className="lg:sticky lg:top-24">
      <ul className="relative flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {NAV.map(({ key, href, icon: Icon, exact }) => {
          const current = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={key}>
              <Link
                href={href}
                className={`${item} lg:w-full`}
                aria-current={current ? 'page' : undefined}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {t(key)}
              </Link>
            </li>
          );
        })}
        <li className="lg:mt-2 lg:border-t lg:border-border lg:pt-2">
          <button type="button" className={`${item} lg:w-full`} onClick={() => void logout()}>
            <LogOut className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
            {t('logout')}
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** Shown until the address is verified: applying and job alerts need it. */
function VerifyBanner() {
  const t = useTranslations('account.verify');
  const { user } = useAccount();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  if (user.emailVerified) {
    return null;
  }
  const resend = async () => {
    setState('sending');
    const { response } = await attempt(
      api.POST('/api/v1/auth/resend-verification', { body: { email: user.email } }),
    );
    setState(response?.ok ? 'sent' : 'failed');
  };
  return (
    <div
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-gold bg-brand-gold-soft p-4 text-brand-navy"
      data-testid="verify-banner"
    >
      <p className="text-sm font-medium" role="status">
        {state === 'sent' ? t('sent', { email: user.email }) : t('text', { email: user.email })}
      </p>
      {state === 'failed' ? <FormError>{t('failed')}</FormError> : null}
      {state !== 'sent' ? (
        <button
          type="button"
          className={cta.outline}
          disabled={state === 'sending'}
          onClick={() => void resend()}
        >
          {t('resend')}
        </button>
      ) : null}
    </div>
  );
}

export function AccountShell({ children }: { children: ReactNode }) {
  const t = useTranslations('account');
  return (
    <div className="container-page py-8">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <AccountNav />
        <div className="min-w-0">
          <AccountProvider
            loading={<Loading lines={5} />}
            failed={(retry) => <LoadFailed onRetry={retry} />}
            staff={<Notice>{t('staffOnly')}</Notice>}
          >
            <VerifyBanner />
            {children}
          </AccountProvider>
        </div>
      </div>
    </div>
  );
}

/** Title of a page of the candidate area, with an optional action on the other side. */
export function PageTitle({
  title,
  intro,
  action,
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {intro ? <p className="mt-1 text-muted-foreground">{intro}</p> : null}
      </div>
      {action}
    </div>
  );
}
