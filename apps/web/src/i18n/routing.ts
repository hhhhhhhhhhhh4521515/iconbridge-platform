import { defineRouting } from 'next-intl/routing';

export const LOCALES = ['fr', 'en', 'ar'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'fr';
export const RTL_LOCALES: readonly AppLocale[] = ['ar'];

export const LOCALE_NAMES: Record<AppLocale, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'العربية',
};

/** Every page lives under /fr, /en or /ar; "/" redirects to the visitor's language, French by default. */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});

export const isRtl = (locale: string) => (RTL_LOCALES as readonly string[]).includes(locale);
