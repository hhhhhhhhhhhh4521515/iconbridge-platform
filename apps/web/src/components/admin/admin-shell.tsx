'use client';

import type { Permission } from '@iconbridge/shared/permissions';
import {
  Award,
  Briefcase,
  ExternalLink,
  FileText,
  Images,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Tags,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { useLogout } from '@/components/layout/auth-actions';
import { ThemeToggle } from '@/components/layout/header-controls';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { cta } from '@/lib/ui';
import { AdminProvider, useAdmin } from './admin-context';
import { AdminPassword } from './password';
import { Badge, ConfirmProvider } from './ui';

interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Shown only to roles holding this permission; absent: every back-office role. */
  needs?: Permission;
  exact?: boolean;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'work',
    items: [
      { key: 'dashboard', href: '/admin', icon: LayoutDashboard, exact: true },
      { key: 'jobs', href: '/admin/jobs', icon: Briefcase, needs: 'VIEW_BACK_OFFICE' },
      { key: 'applications', href: '/admin/applications', icon: FileText },
      { key: 'candidates', href: '/admin/candidates', icon: Users },
      { key: 'messages', href: '/admin/messages', icon: Mail, needs: 'VIEW_BACK_OFFICE' },
    ],
  },
  {
    group: 'content',
    items: [
      { key: 'stories', href: '/admin/content/stories', icon: Award, needs: 'MANAGE_CONTENT' },
      { key: 'slides', href: '/admin/content/slides', icon: Images, needs: 'MANAGE_CONTENT' },
      { key: 'catalog', href: '/admin/content/catalog', icon: Tags, needs: 'VIEW_BACK_OFFICE' },
    ],
  },
  {
    group: 'administration',
    items: [
      { key: 'users', href: '/admin/users', icon: ShieldCheck, needs: 'MANAGE_ADMIN_USERS' },
      { key: 'settings', href: '/admin/settings', icon: Settings, needs: 'MANAGE_SETTINGS' },
      { key: 'audit', href: '/admin/audit', icon: ScrollText, needs: 'MANAGE_SETTINGS' },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();
  const { can } = useAdmin();
  const readsMessages = can('VIEW_BACK_OFFICE');
  const unhandled = useCallback(
    async () =>
      readsMessages
        ? (await api.GET('/api/v1/admin/contact-messages', { params: { query: { pageSize: 1 } } }))
            .data?.unhandled
        : 0,
    [readsMessages],
  );
  const waiting = useLoaded(unhandled).data ?? 0;
  return (
    <nav aria-label={t('label')} className="flex flex-col gap-5 p-3">
      {NAV.map(({ group, items }) => {
        const visible = items.filter((item) => !item.needs || can(item.needs));
        if (visible.length === 0) {
          return null;
        }
        return (
          <div key={group}>
            <p className="mb-1 px-3 text-xs font-semibold tracking-wide text-white/60 uppercase">
              {t(`groups.${group}`)}
            </p>
            <ul>
              {visible.map(({ key, href, icon: Icon, exact }) => {
                const current = exact ? pathname === href : pathname.startsWith(href);
                return (
                  <li key={key}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={current ? 'page' : undefined}
                      className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-white/85 hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/15 aria-[current=page]:text-white"
                    >
                      <Icon className="size-4.5 shrink-0" aria-hidden />
                      <span className="flex-1">{t(key)}</span>
                      {key === 'messages' && waiting > 0 ? (
                        <Badge tone="gold">{waiting}</Badge>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations('admin');
  const common = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const { user } = useAdmin();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  return (
    <div className="flex min-h-dvh bg-muted/40">
      <aside
        id="admin-sidebar"
        className={`fixed inset-y-0 start-0 z-40 w-60 overflow-y-auto bg-brand-navy text-white transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-bold" onClick={close}>
            <Image src="/brand/logo.webp" alt="" width={32} height={32} className="rounded-md" />
            {t('title')}
          </Link>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10 lg:hidden"
            aria-label={common('close')}
            onClick={close}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {user.passwordChangeRequired ? null : <Sidebar onNavigate={close} />}
      </aside>
      {open ? (
        <button
          type="button"
          aria-label={common('close')}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={close}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-2">
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted lg:hidden"
            aria-label={common('openMenu')}
            aria-expanded={open}
            aria-controls="admin-sidebar"
            onClick={() => {
              setOpen(true);
            }}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate font-medium" data-testid="admin-user">
              {user.email}
            </span>
            <Badge tone="info">{t(`roles.${user.role}`)}</Badge>
            {user.assignedCountries.length > 0 ? (
              <span className="text-xs text-muted-foreground" data-testid="admin-countries">
                {user.assignedCountries.join(', ')}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Link href="/" className={`${cta.ghost} px-3 max-md:hidden`}>
              <ExternalLink className="size-4" aria-hidden />
              {t('viewSite')}
            </Link>
            <nav aria-label={common('language')} className="flex text-sm">
              {(['en', 'fr'] as const).map((code) => (
                <Link
                  key={code}
                  href={pathname}
                  locale={code}
                  aria-current={code === locale ? 'true' : undefined}
                  className="inline-flex size-10 items-center justify-center rounded-lg font-medium text-muted-foreground hover:bg-muted aria-[current=true]:bg-secondary aria-[current=true]:text-secondary-foreground"
                >
                  {code.toUpperCase()}
                </Link>
              ))}
            </nav>
            <Link href="/admin/password" className={`${cta.ghost} px-3`}>
              <KeyRound className="size-4" aria-hidden />
              <span className="hidden md:inline">{t('password.menu')}</span>
              <span className="sr-only md:hidden">{t('password.menu')}</span>
            </Link>
            <ThemeToggle lightLabel={common('themeLight')} darkLabel={common('themeDark')} />
            <button type="button" className={`${cta.ghost} px-3`} onClick={() => void logout()}>
              <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
              <span className="hidden md:inline">{t('logout')}</span>
              <span className="sr-only md:hidden">{t('logout')}</span>
            </button>
          </div>
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
          {/* A password chosen by a super admin is replaced before anything else (ADR-024). */}
          {user.passwordChangeRequired ? <AdminPassword forced /> : children}
        </main>
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-lg p-10">{children}</div>;
}

/** Frame of the back office: sidebar by role, top bar, toasts and confirmation dialogs. */
export function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations('admin');
  return (
    <AdminProvider
      loading={
        <Centered>
          <Loading lines={4} />
        </Centered>
      }
      failed={
        <Centered>
          <LoadFailed
            onRetry={() => {
              window.location.reload();
            }}
          />
        </Centered>
      }
      forbidden={
        <Centered>
          <div role="alert" className="space-y-4 text-center" data-testid="admin-forbidden">
            <h1 className="text-2xl font-bold">{t('forbiddenTitle')}</h1>
            <p className="text-muted-foreground">{t('forbiddenText')}</p>
            <Link href="/account" className={cta.primary}>
              {t('goToAccount')}
            </Link>
          </div>
        </Centered>
      }
    >
      <ConfirmProvider>
        <Frame>{children}</Frame>
        <Toaster position="bottom-right" richColors closeButton />
      </ConfirmProvider>
    </AdminProvider>
  );
}
