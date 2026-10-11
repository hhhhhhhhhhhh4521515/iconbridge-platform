import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccountShell } from '@/components/account/account-shell';
import { ClientMessages } from '@/components/layout/client-messages';

export async function generateMetadata({
  params,
}: LayoutProps<'/[locale]/account'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('nav.label'), robots: { index: false, follow: false } };
}

/**
 * The candidate area. Its pages hold personal data, so nothing is rendered on the
 * server: the browser asks the API, with the session cookies, and shows the answer.
 * The proxy sends visitors without a session to the login page before they get here.
 */
export default async function AccountLayout({
  children,
  params,
}: LayoutProps<'/[locale]/account'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <ClientMessages groups={['account', 'auth']}>
      <AccountShell>{children}</AccountShell>
    </ClientMessages>
  );
}
