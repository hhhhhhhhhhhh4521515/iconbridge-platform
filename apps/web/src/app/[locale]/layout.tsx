import type { Metadata, Viewport } from 'next';
import { Cairo, Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { Providers } from '@/components/layout/providers';
import { Footer, Header, TopBar } from '@/components/layout/site-chrome';
import { isRtl, routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/seo';
import '../globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Not preloaded: only Arabic pages use it, and the browser fetches it when it is needed.
const cairo = Cairo({
  subsets: ['arabic'],
  variable: '--font-cairo',
  display: 'swap',
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0629' },
  ],
};

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${t('homeTitle')} | ${t('siteName')}`, template: `%s | ${t('siteName')}` },
    description: t('homeDescription'),
    applicationName: t('siteName'),
    icons: { icon: '/brand/logo.png', apple: '/brand/logo.png' },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const [t, messages] = await Promise.all([getTranslations('common'), getMessages()]);
  return (
    <html
      lang={locale}
      dir={isRtl(locale) ? 'rtl' : 'ltr'}
      className={`${inter.variable} ${cairo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {/* Client components only need these two groups of texts (error page, header). */}
        <NextIntlClientProvider messages={{ common: messages.common, errors: messages.errors }}>
          <Providers>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
            >
              {t('skipToContent')}
            </a>
            <TopBar />
            <Header />
            <main id="main" className="flex-1">
              {children}
            </main>
            <Footer />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
