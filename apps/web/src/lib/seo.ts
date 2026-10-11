import type { Metadata } from 'next';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/routing';

/** Read directly: this value is public and also needed where `env` (server-only) cannot be imported. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

export const localizedUrl = (locale: string, path = '') => `${SITE_URL}/${locale}${path}`;

/**
 * Canonical link and hreflang alternates of a page that exists in every language.
 * `path` is the part after the locale, e.g. "/jobs/welder-poland" ("" for the home page).
 */
export function alternates(locale: string, path = ''): NonNullable<Metadata['alternates']> {
  return {
    canonical: localizedUrl(locale, path),
    languages: {
      ...Object.fromEntries(LOCALES.map((code) => [code, localizedUrl(code, path)])),
      'x-default': localizedUrl(DEFAULT_LOCALE, path),
    },
  };
}

export function pageMetadata(options: {
  locale: string;
  path?: string;
  title: string;
  description: string;
  siteName: string;
}): Metadata {
  const { locale, path = '', title, description, siteName } = options;
  return {
    title,
    description,
    alternates: alternates(locale, path),
    openGraph: {
      type: 'website',
      siteName,
      title,
      description,
      url: localizedUrl(locale, path),
      locale,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}
