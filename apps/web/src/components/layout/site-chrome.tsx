import { Mail, MessageCircle, Phone } from 'lucide-react';
import Image from 'next/image';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { pick } from '@/lib/format';
import { AuthActions } from './auth-actions';
import { LocaleSwitcher, MobileMenu, ThemeToggle } from './header-controls';

const NAV = [
  { key: 'home', href: '/' },
  { key: 'jobs', href: '/jobs' },
  { key: 'destinations', href: '/#destinations' },
  { key: 'stories', href: '/success-stories' },
  { key: 'about', href: '/about' },
  { key: 'contact', href: '/contact' },
] as const;

const digits = (value: string) => value.replace(/[^\d+]/g, '');

/** Phone, email and WhatsApp of the agency, from the settings of the back office. */
export async function TopBar() {
  const [t, info] = await Promise.all([getTranslations('topbar'), api.siteInfo()]);
  const items = [
    info?.CONTACT_PHONE && {
      icon: Phone,
      label: t('phone'),
      text: info.CONTACT_PHONE,
      href: `tel:${digits(info.CONTACT_PHONE)}`,
    },
    info?.CONTACT_EMAIL && {
      icon: Mail,
      label: t('email'),
      text: info.CONTACT_EMAIL,
      href: `mailto:${info.CONTACT_EMAIL}`,
    },
    info?.CONTACT_WHATSAPP && {
      icon: MessageCircle,
      label: t('whatsapp'),
      text: info.CONTACT_WHATSAPP,
      href: `https://wa.me/${digits(info.CONTACT_WHATSAPP).replace('+', '')}`,
    },
  ].filter((item) => item !== '' && item !== undefined && item !== null);
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="bg-brand-navy text-white">
      <ul className="container-page flex flex-wrap items-center gap-x-6 gap-y-1 py-1.5 text-xs sm:text-sm">
        {items.map((item) => (
          <li key={item.label}>
            <a
              href={item.href}
              className="inline-flex min-h-8 items-center gap-1.5 hover:underline"
            >
              <item.icon className="size-4" aria-hidden />
              <span className="sr-only">{item.label}: </span>
              <span dir="ltr">{item.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Logo({ name }: { name: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label={name}>
      <Image src="/brand/logo.webp" alt="" width={44} height={44} className="rounded-lg" priority />
      <span className="text-lg leading-tight font-bold tracking-tight text-foreground">
        IconBridge <span className="font-medium text-muted-foreground">Jobs</span>
      </span>
    </Link>
  );
}

export async function Header() {
  const [t, common] = await Promise.all([getTranslations('nav'), getTranslations('common')]);
  const links = NAV.map((item) => (
    <li key={item.key}>
      <Link
        href={item.href}
        className="inline-flex min-h-11 items-center rounded-lg px-2.5 text-sm font-medium whitespace-nowrap text-foreground hover:bg-muted"
      >
        {t(item.key)}
      </Link>
    </li>
  ));
  const actions = (
    <AuthActions
      labels={{
        jobSeeker: t('jobSeeker'),
        login: t('login'),
        account: t('account'),
        logout: t('logout'),
      }}
    />
  );
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="container-page relative flex items-center justify-between gap-3 py-2">
        <Logo name={common('brand')} />
        <nav aria-label={t('main')} className="hidden xl:block">
          <ul className="flex items-center">{links}</ul>
        </nav>
        <div className="flex items-center gap-1">
          <div className="hidden sm:block">
            <LocaleSwitcher label={common('language')} />
          </div>
          <ThemeToggle lightLabel={common('themeLight')} darkLabel={common('themeDark')} />
          <div className="hidden items-center gap-2 xl:flex">{actions}</div>
          <MobileMenu openLabel={common('openMenu')} closeLabel={common('close')}>
            <nav aria-label={t('main')}>
              <ul className="flex flex-col">{links}</ul>
            </nav>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {actions}
            </div>
            <div className="mt-3 sm:hidden">
              <LocaleSwitcher label={common('language')} />
            </div>
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}

const SOCIAL = [
  { name: 'Facebook', href: 'https://www.facebook.com/' },
  { name: 'Instagram', href: 'https://www.instagram.com/' },
  { name: 'LinkedIn', href: 'https://www.linkedin.com/' },
] as const;

export async function Footer() {
  const [t, nav, common, locale, categories, info] = await Promise.all([
    getTranslations('footer'),
    getTranslations('nav'),
    getTranslations('common'),
    getLocale(),
    api.categories(),
    api.siteInfo(),
  ]);
  const heading = 'mb-3 text-sm font-semibold tracking-wide text-white uppercase';
  const link =
    'inline-flex min-h-9 items-center text-sm text-white/80 hover:text-white hover:underline';
  return (
    <footer className="mt-16 bg-brand-navy text-white">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src="/brand/logo.webp" alt="" width={44} height={44} className="rounded-lg" />
            <span className="text-lg font-bold">{common('brand')}</span>
          </div>
          <p className="mt-3 text-sm text-white/80">{t('tagline')}</p>
          <p className="mt-4 rounded-lg border border-brand-gold/60 bg-white/5 p-3 text-sm font-medium text-white">
            {common('neverPay')}
          </p>
        </div>
        <div>
          <h2 className={heading}>{t('categories')}</h2>
          <ul>
            {categories.slice(0, 8).map((category) => (
              <li key={category.id}>
                <Link href={`/jobs?category=${category.slug}`} className={link}>
                  {pick(category.name, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className={heading}>{t('explore')}</h2>
          <ul>
            {NAV.filter((item) => item.key !== 'home').map((item) => (
              <li key={item.key}>
                <Link href={item.href} className={link}>
                  {nav(item.key)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className={heading}>{t('contact')}</h2>
          <ul className="text-sm text-white/80">
            {info?.CONTACT_EMAIL ? (
              <li>
                <a href={`mailto:${info.CONTACT_EMAIL}`} className={link}>
                  {info.CONTACT_EMAIL}
                </a>
              </li>
            ) : null}
            {info?.CONTACT_PHONE ? (
              <li>
                <a href={`tel:${digits(info.CONTACT_PHONE)}`} className={link} dir="ltr">
                  {info.CONTACT_PHONE}
                </a>
              </li>
            ) : null}
            {info?.CONTACT_ADDRESS ? <li className="py-1.5">{info.CONTACT_ADDRESS}</li> : null}
          </ul>
          <h2 className={`${heading} mt-6`}>{t('follow')}</h2>
          <ul className="flex flex-wrap gap-x-4">
            {SOCIAL.map((network) => (
              <li key={network.name}>
                <a href={network.href} className={link} rel="noopener noreferrer" target="_blank">
                  {network.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/15">
        <div className="container-page flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 text-sm text-white/80">
          <p>
            © {new Date().getUTCFullYear()} IconBridge Recruitment Ltd. {t('rights')}
          </p>
          <ul className="flex flex-wrap gap-x-5">
            <li>
              <Link href="/privacy" className={link}>
                {t('privacy')}
              </Link>
            </li>
            <li>
              <Link href="/terms" className={link}>
                {t('terms')}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
