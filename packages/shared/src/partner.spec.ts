import { describe, expect, it } from 'vitest';
import { LOCALES, PARTNER_LOCALES } from './i18n.js';
import {
  createPartnerLoginSchema,
  createPartnerSpaceSchema,
  deletePartnerSpaceSchema,
  updatePartnerLoginSchema,
  updatePartnerSpaceSchema,
} from './partner.js';

describe('partner spaces: management schemas', () => {
  it('speaks English, French and Polish, while the site keeps English, French and Arabic', () => {
    expect([...PARTNER_LOCALES]).toEqual(['en', 'fr', 'pl']);
    expect([...LOCALES]).toEqual(['en', 'fr', 'ar']);
  });

  it('creates a space with a name, a country code and a language of the partner area', () => {
    expect(
      createPartnerSpaceSchema.parse({ name: '  Clean Co ', country: 'pl', defaultLocale: 'pl' }),
    ).toEqual({ name: 'Clean Co', country: 'PL', defaultLocale: 'pl' });
    for (const body of [
      { name: 'C', country: 'PL', defaultLocale: 'pl' },
      { name: 'Clean Co', country: 'Poland', defaultLocale: 'pl' },
      { name: 'Clean Co', country: 'PL', defaultLocale: 'ar' },
      { name: 'x'.repeat(121), country: 'PL', defaultLocale: 'en' },
    ]) {
      expect(createPartnerSpaceSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('refuses an empty change', () => {
    expect(updatePartnerSpaceSchema.safeParse({}).success).toBe(false);
    expect(updatePartnerSpaceSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updatePartnerLoginSchema.safeParse({}).success).toBe(false);
  });

  it('needs a typed name to delete a space', () => {
    expect(deletePartnerSpaceSchema.safeParse({}).success).toBe(false);
    expect(deletePartnerSpaceSchema.safeParse({ confirmName: '   ' }).success).toBe(false);
  });

  it('creates a partner login with an address in lower case, a display name and a password', () => {
    expect(
      createPartnerLoginSchema.parse({
        email: 'Anna@Clean.example',
        displayName: 'Anna K.',
        password: 'river-lantern-quartz-42',
      }),
    ).toMatchObject({ email: 'anna@clean.example', displayName: 'Anna K.' });
    expect(
      createPartnerLoginSchema.safeParse({ email: 'anna@clean.example', displayName: 'Anna' })
        .success,
    ).toBe(false);
  });
});
