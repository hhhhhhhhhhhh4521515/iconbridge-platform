import type { AppLocale } from '@/i18n/routing';

export interface LocalizedText {
  en: string;
  fr: string;
  ar: string;
}

/** Text in the visitor's language, falling back to English then French. */
export function pick(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) {
    return '';
  }
  const value = locale in text ? text[locale as AppLocale] : '';
  return value || text.en || text.fr;
}

/** "1 200 €", "4 800 zł": the amount in its currency, written for the visitor's language. */
export function money(amount: number, currency: string | null, locale: string): string {
  if (!currency) {
    return new Intl.NumberFormat(locale).format(amount);
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale).format(amount)} ${currency}`;
  }
}

/** "English", "anglais", "الإنجليزية" for the code "en". */
export function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function longDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

/** Local file of the brand kit for a destination, used when the API has no picture. */
export const DESTINATION_IMAGES: Record<string, string> = {
  MALTA: '/brand/hero-malta-1.webp',
  POLAND: '/brand/hero-poland-1.webp',
  CRUISE_SHIP: '/brand/hero-cruise-1.webp',
};
