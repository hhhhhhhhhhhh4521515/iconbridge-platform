import { describe, expect, it } from 'vitest';
import { localizedTextSchema } from './i18n.js';
import { DEFAULT_SETTINGS, SETTING_KEYS, settingSchemas } from './settings.js';

describe('settings', () => {
  it('uses the defaults of the specification', () => {
    expect(DEFAULT_SETTINGS.REAPPLY_COOLDOWN_MONTHS).toBe(6);
    expect(DEFAULT_SETTINGS.MAX_ACTIVE_APPLICATIONS).toBe(5);
    expect(DEFAULT_SETTINGS.MAX_UPLOAD_SIZE_MB).toBe(5);
  });

  it.each(SETTING_KEYS)('has a default for %s that its own schema accepts', (key) => {
    expect(settingSchemas[key].safeParse(DEFAULT_SETTINGS[key]).success).toBe(true);
  });

  it('ships no placeholder contact details: the site shows nothing until they are set', () => {
    for (const key of [
      'CONTACT_EMAIL',
      'CONTACT_PHONE',
      'CONTACT_WHATSAPP',
      'CONTACT_ADDRESS',
    ] as const) {
      expect(DEFAULT_SETTINGS[key]).toBe('');
    }
    expect(settingSchemas.CONTACT_EMAIL.safeParse('hello@agency.test').success).toBe(true);
    expect(settingSchemas.CONTACT_EMAIL.safeParse('not-an-email').success).toBe(false);
  });

  it('rejects a negative cooldown and a non-integer value', () => {
    expect(settingSchemas.REAPPLY_COOLDOWN_MONTHS.safeParse(-1).success).toBe(false);
    expect(settingSchemas.REAPPLY_COOLDOWN_MONTHS.safeParse(1.5).success).toBe(false);
  });
});

describe('localizedTextSchema', () => {
  it('requires the three site languages', () => {
    expect(localizedTextSchema.safeParse({ en: 'Malta', fr: 'Malte', ar: 'مالطا' }).success).toBe(
      true,
    );
    expect(localizedTextSchema.safeParse({ en: 'Malta', fr: 'Malte' }).success).toBe(false);
    expect(localizedTextSchema.safeParse({ en: 'Malta', fr: '', ar: 'مالطا' }).success).toBe(false);
  });
});
