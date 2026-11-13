'use client';

import Image from 'next/image';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/header-controls';
import {
  isPartnerLang,
  LANG_CHOSEN_COOKIE,
  PARTNER_LANG_NAMES,
  PARTNER_LANGS,
  partnerHref,
  siteLocaleForPartner,
  type PartnerLang,
} from '@/lib/partner-locale';

function usePartnerLang(): PartnerLang {
  const locale = useLocale();
  return isPartnerLang(locale) ? locale : 'en';
}

/** The language switch: the same page in another language. */
function LanguageSwitch({ lang }: { lang: PartnerLang }) {
  const t = useTranslations('partner.header');
  const pathname = usePathname();
  const rest = pathname.replace(/^\/partners\/[a-z]{2}/, '');
  return (
    <nav aria-label={t('language')} className="flex text-sm">
      {PARTNER_LANGS.map((code) => (
        <a
          key={code}
          href={`${partnerHref(code, rest)}${typeof window === 'undefined' ? '' : window.location.search}`}
          hrefLang={code}
          lang={code}
          aria-current={code === lang ? 'true' : undefined}
          title={PARTNER_LANG_NAMES[code]}
          onClick={() => {
            document.cookie = `${LANG_CHOSEN_COOKIE}=1; path=/partners; max-age=31536000; samesite=lax; secure`;
          }}
          className="inline-flex size-10 items-center justify-center rounded-lg font-medium text-muted-foreground hover:bg-muted aria-[current=true]:bg-secondary aria-[current=true]:text-secondary-foreground"
        >
          {code.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}

/**
 * The header of every partner screen, in the site's style: the IconBridge logo (to the public
 * site, in the nearest language), the partner area's name, the language and the theme. The
 * screens of a space put their menu under it (`children`), in the same banner.
 */
export function PartnerHeader({ children }: { children?: ReactNode }) {
  const lang = usePartnerLang();
  const t = useTranslations('partner.header');
  const common = useTranslations('common');
  const site = siteLocaleForPartner(lang);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="container-page flex flex-wrap items-center justify-between gap-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          {/* A plain link: the site is another root layout, with its own languages. */}
          <a
            href={`/${site}`}
            className="flex items-center gap-2.5 rounded-lg"
            aria-label={t('siteLink')}
            hrefLang={site}
          >
            <Image
              src="/brand/logo.webp"
              alt=""
              width={44}
              height={44}
              className="rounded-lg"
              loading="eager"
            />
            <span className="hidden text-lg leading-tight font-bold tracking-tight text-foreground sm:inline">
              IconBridge <span className="font-medium text-muted-foreground">Jobs</span>
            </span>
          </a>
          <span
            className="rounded-full bg-brand-gold px-3 py-1 text-xs font-semibold whitespace-nowrap text-brand-navy"
            data-testid="partner-area-label"
          >
            {t('area')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <LanguageSwitch lang={lang} />
          <ThemeToggle lightLabel={common('themeLight')} darkLabel={common('themeDark')} />
        </div>
      </div>
      {children ? (
        <div className="border-t border-border bg-muted/40">
          <div className="container-page py-1.5">{children}</div>
        </div>
      ) : null}
    </header>
  );
}

/** The footer of every partner screen: the site's navy footer, with its legal links. */
export function PartnerFooter() {
  const lang = usePartnerLang();
  const t = useTranslations('partner.footer');
  const site = siteLocaleForPartner(lang);
  const link =
    'inline-flex min-h-11 items-center text-sm text-white/80 hover:text-white hover:underline';
  const links = [
    { href: `/${site}`, label: t('site') },
    { href: `/${site}/contact`, label: t('contact') },
    { href: `/${site}/privacy`, label: t('privacy') },
    { href: `/${site}/terms`, label: t('terms') },
  ];
  return (
    <footer className="mt-16 bg-brand-navy text-white" data-testid="partner-footer">
      <div className="container-page flex flex-wrap items-center justify-between gap-6 py-8">
        <div className="flex items-center gap-2.5">
          <Image src="/brand/logo.webp" alt="" width={44} height={44} className="rounded-lg" />
          <div>
            <p className="text-lg font-bold">IconBridge Jobs</p>
            <p className="text-sm text-white/80">{t('tagline')}</p>
          </div>
        </div>
        <nav aria-label={t('label')}>
          <ul className="flex flex-wrap gap-x-5">
            {links.map((item) => (
              <li key={item.href}>
                <NextLink href={item.href} hrefLang={site} className={link}>
                  {item.label}
                </NextLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/15">
        <p className="container-page py-4 text-sm text-white/80">
          © {new Date().getUTCFullYear()} IconBridge Recruitment Ltd. {t('rights')}
        </p>
      </div>
    </footer>
  );
}
