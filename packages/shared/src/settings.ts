import { z } from 'zod';

/**
 * Global settings stored in the `settings` table (key + JSON value) and edited by
 * the super admin. Each key has its own schema; the defaults are what the seed inserts.
 */
/** An https address, or empty when the agency has no page there. */
const socialUrl = z
  .string()
  .trim()
  .max(300)
  .regex(/^(https:\/\/\S+)?$/, 'Use an https address, or leave it empty');

export const settingSchemas = {
  /** Calendar months before a candidate may apply to the same job again. */
  REAPPLY_COOLDOWN_MONTHS: z.number().int().min(0).max(60),
  /** Applications a candidate may have in progress at the same time. */
  MAX_ACTIVE_APPLICATIONS: z.number().int().min(1).max(100),
  /** Largest accepted upload, in megabytes. */
  MAX_UPLOAD_SIZE_MB: z.number().int().min(1).max(25),
  /** Contact details shown on the site. The contact form is emailed to CONTACT_EMAIL. */
  CONTACT_EMAIL: z.email().max(254),
  CONTACT_PHONE: z.string().trim().max(30),
  CONTACT_WHATSAPP: z.string().trim().max(30),
  CONTACT_ADDRESS: z.string().trim().max(300),
  /** Pages of the agency on the social networks, shown in the footer. Empty: the link is hidden. */
  SOCIAL_FACEBOOK: socialUrl,
  SOCIAL_INSTAGRAM: socialUrl,
  SOCIAL_TIKTOK: socialUrl,
  SOCIAL_LINKEDIN: socialUrl,
  /** When true, recruiters may delete candidates and applications; otherwise only a super admin. */
  ALLOW_RECRUITER_DELETE: z.boolean(),
} as const;

/** Settings anyone may read: the contact block and the social links of the site. */
export const PUBLIC_SETTING_KEYS = [
  'CONTACT_EMAIL',
  'CONTACT_PHONE',
  'CONTACT_WHATSAPP',
  'CONTACT_ADDRESS',
  'SOCIAL_FACEBOOK',
  'SOCIAL_INSTAGRAM',
  'SOCIAL_TIKTOK',
  'SOCIAL_LINKEDIN',
] as const satisfies readonly (keyof typeof settingSchemas)[];

/** Every setting with its value: body of GET /admin/settings. */
export const settingValuesSchema = z.object(settingSchemas);

export type SettingKey = keyof typeof settingSchemas;
export type SettingValues = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> };

export const SETTING_KEYS = Object.keys(settingSchemas) as SettingKey[];

export const DEFAULT_SETTINGS: SettingValues = {
  REAPPLY_COOLDOWN_MONTHS: 6,
  MAX_ACTIVE_APPLICATIONS: 5,
  MAX_UPLOAD_SIZE_MB: 5,
  CONTACT_EMAIL: 'contact@iconbridge.local',
  CONTACT_PHONE: '',
  CONTACT_WHATSAPP: '',
  CONTACT_ADDRESS: '',
  SOCIAL_FACEBOOK: '',
  SOCIAL_INSTAGRAM: '',
  SOCIAL_TIKTOK: '',
  SOCIAL_LINKEDIN: '',
  ALLOW_RECRUITER_DELETE: false,
};
