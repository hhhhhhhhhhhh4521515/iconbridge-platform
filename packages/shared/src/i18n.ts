import './zod-setup.js';
import { z } from 'zod';

/** Languages of the site. Arabic is right-to-left. */
export const LOCALES = ['en', 'fr', 'ar'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Languages of the partner area (ADR-027): English, French and Polish. The public site and
 * the back office keep LOCALES; `pl` is never added there.
 */
export const PARTNER_LOCALES = ['en', 'fr', 'pl'] as const;
export const partnerLocaleSchema = z.enum(PARTNER_LOCALES);
export type PartnerLocale = z.infer<typeof partnerLocaleSchema>;

/** Shape of the i18n JSON columns (destination name, slide title, story quote...). */
export const localizedTextSchema = z.object({
  en: z.string().min(1),
  fr: z.string().min(1),
  ar: z.string().min(1),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** The same shape where every language may be empty (an optional translated text). */
export const optionalLocalizedTextSchema = z.object({
  en: z.string().trim().max(2000),
  fr: z.string().trim().max(2000),
  ar: z.string().trim().max(2000),
});
export type OptionalLocalizedText = z.infer<typeof optionalLocalizedTextSchema>;
