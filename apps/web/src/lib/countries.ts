import { COUNTRY_CODES } from '@iconbridge/shared/countries';

/** The flag of a country as an emoji: two "regional indicator" letters. */
export function flag(code: string): string {
  return [...code.toUpperCase()]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join('');
}

export interface CountryOption {
  code: string;
  name: string;
}

/** Every country, named in the visitor's language and sorted by that name. */
export function countryOptions(locale: string): CountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const collator = new Intl.Collator(locale);
  return COUNTRY_CODES.map((code) => ({ code: code as string, name: names.of(code) ?? code })).sort(
    (a, b) => collator.compare(a.name, b.name),
  );
}

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Languages a candidate can declare, as ISO 639-1 codes. */
export const SPOKEN_LANGUAGES = [
  'ar',
  'en',
  'fr',
  'de',
  'it',
  'es',
  'pt',
  'pl',
  'mt',
  'nl',
  'ru',
  'tr',
  'uk',
  'ro',
  'el',
  'zh',
  'hi',
  'ur',
  'bn',
  'tl',
  'id',
  'sw',
  'am',
  'ha',
  'sv',
  'no',
  'da',
  'fi',
  'cs',
  'hu',
  'bg',
  'sr',
  'hr',
  'ja',
  'ko',
  'vi',
  'th',
  'fa',
  'he',
  'ne',
  'si',
  'ta',
] as const;

export const DRIVING_LICENCE_CATEGORIES = [
  'AM',
  'A1',
  'A2',
  'A',
  'B',
  'BE',
  'C1',
  'C1E',
  'C',
  'CE',
  'D1',
  'D1E',
  'D',
  'DE',
] as const;
