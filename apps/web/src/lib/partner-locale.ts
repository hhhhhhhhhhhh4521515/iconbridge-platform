/** Languages of the partner area (ADR-027): its own, not the site's (fr, en, ar). */
export const PARTNER_LANGS = ['en', 'fr', 'pl'] as const;
export type PartnerLang = (typeof PARTNER_LANGS)[number];

export const PARTNER_LANG_NAMES: Record<PartnerLang, string> = {
  en: 'English',
  fr: 'Français',
  pl: 'Polski',
};

export const isPartnerLang = (value: string): value is PartnerLang =>
  (PARTNER_LANGS as readonly string[]).includes(value);

/** Address of a page of the partner area, in a language. */
export const partnerHref = (lang: PartnerLang, path = ''): string =>
  `/partners/${lang}${path.startsWith('/') || path === '' ? path : `/${path}`}`;

export async function partnerMessages(lang: PartnerLang): Promise<Record<string, unknown>> {
  return (await import(`../messages/partner/${lang}.json`)).default as Record<string, unknown>;
}

/** One text of the partner messages, for the server (page titles). */
export async function partnerText(lang: PartnerLang, key: string): Promise<string> {
  let node: unknown = (await partnerMessages(lang)).partner;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === 'string' ? node : key;
}
