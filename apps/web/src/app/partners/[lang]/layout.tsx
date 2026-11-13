import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { Providers } from '@/components/layout/providers';
import { isPartnerLang, partnerMessages, PARTNER_LANGS } from '@/lib/partner-locale';
import { SITE_URL } from '@/lib/seo';
import '../../globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });

/** The two texts the server writes itself: the title and the notice without JavaScript. */
const metaOf = (messages: Record<string, unknown>) =>
  (messages as { partner: { meta: { title: string; noscript: string } } }).partner.meta;

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
    // Private: never indexed, never linked from the public site (ADR-027).
    robots: { index: false, follow: false },
  };
}

/**
 * The partner area (ADR-027): a root layout of its own, in English, French or Polish,
 * outside the site's languages. Signed-in screens render in the browser, like the candidate
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
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-muted/40 text-foreground">
        <noscript>
          <p className="m-4 rounded-lg border border-border bg-background p-4 text-sm">
            {meta.noscript}
          </p>
        </noscript>
        <NextIntlClientProvider locale={lang} messages={messages} timeZone="UTC">
          <Providers nonce={nonce}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
