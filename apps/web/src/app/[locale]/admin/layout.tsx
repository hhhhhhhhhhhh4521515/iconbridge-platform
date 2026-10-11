import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { AdminShell } from '@/components/admin/admin-shell';

export const metadata: Metadata = {
  title: 'Back office',
  robots: { index: false, follow: false },
};

/**
 * The back office. Like the candidate area, it renders a frame on the server and
 * every piece of data is asked from the API by the browser, with the session of
 * the person: the API checks the role on each call. Its texts exist in English and
 * French and are loaded here only, not with the public site.
 */
export default async function AdminLayout({ children, params }: LayoutProps<'/[locale]/admin'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();
  const admin = (
    (await import(`@/messages/admin/${locale === 'fr' ? 'fr' : 'en'}.json`)) as {
      default: Record<string, unknown>;
    }
  ).default;
  return (
    <NextIntlClientProvider
      messages={{ common: messages.common, errors: messages.errors, forms: messages.forms, admin }}
    >
      <AdminShell>{children}</AdminShell>
    </NextIntlClientProvider>
  );
}
