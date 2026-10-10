import { z } from 'zod';

/**
 * Global settings stored in the `settings` table (key + JSON value) and edited by
 * the super admin. Each key has its own schema; the defaults are what the seed inserts.
 */
export const settingSchemas = {
  /** Calendar months before a candidate may apply to the same job again. */
  REAPPLY_COOLDOWN_MONTHS: z.number().int().min(0).max(60),
  /** Applications a candidate may have in progress at the same time. */
  MAX_ACTIVE_APPLICATIONS: z.number().int().min(1).max(100),
  /** Largest accepted upload, in megabytes. */
  MAX_UPLOAD_SIZE_MB: z.number().int().min(1).max(25),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValues = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> };

export const SETTING_KEYS = Object.keys(settingSchemas) as SettingKey[];

export const DEFAULT_SETTINGS: SettingValues = {
  REAPPLY_COOLDOWN_MONTHS: 6,
  MAX_ACTIVE_APPLICATIONS: 5,
  MAX_UPLOAD_SIZE_MB: 5,
};
