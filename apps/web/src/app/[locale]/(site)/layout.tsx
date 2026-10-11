import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Footer, Header, TopBar } from '@/components/layout/site-chrome';

/** The public site and the candidate area: top bar, header, page, footer. The back office has its own frame. */
export default async function SiteLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');
  return (
    <>
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
    </>
  );
}
