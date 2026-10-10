import { z } from 'zod';

/** Languages of the site. Arabic is right-to-left. */
export const LOCALES = ['en', 'fr', 'ar'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const DEFAULT_LOCALE: Locale = 'en';

/** Shape of the i18n JSON columns (destination name, slide title, story quote...). */
export const localizedTextSchema = z.object({
  en: z.string().min(1),
  fr: z.string().min(1),
  ar: z.string().min(1),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;
