import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { Providers } from '@/components/layout/providers';
import { PartnerFooter } from '@/components/partner/partner-chrome';
import { isPartnerLang, partnerMessages, PARTNER_LANGS } from '@/lib/partner-locale';
import { fontVariables } from '@/lib/fonts';
import { SITE_URL } from '@/lib/seo';
import '../../globals.css';

/** The texts the server writes itself: the title, the notice without JavaScript, the skip link. */
const metaOf = (messages: Record<string, unknown>) => {
  const typed = messages as {
    partner: { meta: { title: string; noscript: string } };
    common: { skipToContent: string };
  };
  return { ...typed.partner.meta, skip: typed.common.skipToContent };
};

export function generateStaticParams() {
  return PARTNER_LANGS.map((lang) => ({ lang }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0629' },
  ],
};

export async function generateMetadata({
  params,
}: LayoutProps<'/partners/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  if (!isPartnerLang(lang)) {
    return {};
  }
  const meta = metaOf(await partnerMessages(lang));
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${meta.title} | IconBridge`, template: `%s | ${meta.title}` },
    // Never indexed, the sign-in included (ADR-027, amendment 2): it has nothing to find,
    // partners arrive from the site's header and footer, and the candidates' sign-in is
    // treated the same way (robots.txt disallows /*/login; the proxy sends x-robots-tag).
    robots: { index: false, follow: false },
  };
}

/**
 * The partner area (ADR-027): a root layout of its own, in English, French or Polish,
 * outside the site's languages, with the site's fonts, colours, header and footer. Signed-in screens render in the browser, like the candidate
 * area and the back office; without JavaScript the page says so.
 */
export default async function PartnerLayout({ children, params }: LayoutProps<'/partners/[lang]'>) {
  const { lang } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  const messages = await partnerMessages(lang);
  const meta = metaOf(messages);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang={lang}
      dir="ltr"
      className={`${fontVariables} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          {meta.skip}
        </a>
        <noscript>
          <p className="m-4 rounded-lg border border-border bg-background p-4 text-sm">
            {meta.noscript}
          </p>
        </noscript>
        <NextIntlClientProvider locale={lang} messages={messages} timeZone="UTC">
          <Providers nonce={nonce}>
            {children}
            <PartnerFooter />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
