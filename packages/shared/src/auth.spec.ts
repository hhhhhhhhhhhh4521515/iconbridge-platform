import { describe, expect, it } from 'vitest';
import {
  changeAdminRoleSchema,
  createAdminUserSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.js';
import { createSuccessStorySchema } from './admin.js';

const valid = {
  email: '  Amira.Test@Example.TEST ',
  password: 'a-long-enough-password',
  firstName: ' Amira ',
  lastName: 'Test',
  phone: '+21612345678',
  country: 'tn',
  gdprConsent: true,
  turnstileToken: 'token',
};

describe('registerSchema', () => {
  it('normalises email, names and country, and defaults the locale', () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('amira.test@example.test');
    expect(parsed.firstName).toBe('Amira');
    expect(parsed.country).toBe('TN');
    expect(parsed.locale).toBe('en');
  });

  it('requires GDPR consent to be true', () => {
    expect(registerSchema.safeParse({ ...valid, gdprConsent: false }).success).toBe(false);
    const { gdprConsent: _omitted, ...withoutConsent } = valid;
    expect(registerSchema.safeParse(withoutConsent).success).toBe(false);
  });

  it('requires a password of at least 10 characters', () => {
    expect(registerSchema.safeParse({ ...valid, password: '123456789' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: '1234567890' }).success).toBe(true);
  });

  it('requires an international phone number and a two-letter country', () => {
    expect(registerSchema.safeParse({ ...valid, phone: '0612345678' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, country: 'Tunisia' }).success).toBe(false);
  });

  it('requires a Turnstile token and a known locale', () => {
    expect(registerSchema.safeParse({ ...valid, turnstileToken: '' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, locale: 'de' }).success).toBe(false);
    expect(registerSchema.parse({ ...valid, locale: 'ar' }).locale).toBe('ar');
  });

  it('drops unknown fields such as a role', () => {
    expect(registerSchema.parse({ ...valid, role: 'SUPER_ADMIN' })).not.toHaveProperty('role');
  });
});

describe('other auth schemas', () => {
  it('lower-cases the login email', () => {
    expect(loginSchema.parse({ email: 'A@B.TEST', password: 'x' }).email).toBe('a@b.test');
  });

  it('rejects short tokens and short passwords on reset', () => {
    const token = 'x'.repeat(43);
    expect(
      resetPasswordSchema.safeParse({ token: 'short', password: 'long-enough-pass' }).success,
    ).toBe(false);
    expect(resetPasswordSchema.safeParse({ token, password: 'short' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token, password: 'long-enough-pass' }).success).toBe(
      true,
    );
  });

  it('does not let an admin account be created as a candidate', () => {
    expect(createAdminUserSchema.safeParse({ email: 'a@b.test', role: 'CANDIDATE' }).success).toBe(
      false,
    );
    expect(createAdminUserSchema.safeParse({ email: 'a@b.test', role: 'VIEWER' }).success).toBe(
      true,
    );
  });
});

describe('country agents (ADR-024)', () => {
  const agent = { email: 'bihi@example.test', role: 'COUNTRY_AGENT' } as const;

  it('needs at least one country for an agent, none for the other roles', () => {
    expect(
      createAdminUserSchema.safeParse({ ...agent, countries: ['ma'] }).data?.countries,
    ).toEqual(['MA']);
    expect(createAdminUserSchema.safeParse(agent).success).toBe(false);
    expect(createAdminUserSchema.safeParse({ ...agent, countries: [] }).success).toBe(false);
    expect(
      createAdminUserSchema.safeParse({
        email: 'r@example.test',
        role: 'RECRUITER',
        countries: ['TN'],
      }).success,
    ).toBe(false);
    expect(
      changeAdminRoleSchema.safeParse({ role: 'COUNTRY_AGENT', countries: ['TN'] }).success,
    ).toBe(true);
    expect(changeAdminRoleSchema.safeParse({ role: 'COUNTRY_AGENT' }).success).toBe(false);
  });

  it('refuses unknown or repeated country codes', () => {
    expect(createAdminUserSchema.safeParse({ ...agent, countries: ['XX'] }).success).toBe(false);
    expect(createAdminUserSchema.safeParse({ ...agent, countries: ['MA', 'ma'] }).success).toBe(
      false,
    );
  });

  it('takes an optional first password of the usual length', () => {
    expect(
      createAdminUserSchema.safeParse({ ...agent, countries: ['MA'], password: 'short' }).success,
    ).toBe(false);
    expect(
      createAdminUserSchema.safeParse({
        ...agent,
        countries: ['MA'],
        password: 'river-lantern-quartz-42',
      }).success,
    ).toBe(true);
  });
});

describe('success story quote', () => {
  const story = {
    firstName: 'Amira',
    jobTitle: 'Waiter',
    destinationId: '00000000-0000-4000-8000-000000000000',
  };

  it('is optional in the three languages', () => {
    expect(createSuccessStorySchema.parse(story).quote).toEqual({ en: '', fr: '', ar: '' });
    expect(
      createSuccessStorySchema.parse({ ...story, quote: { en: ' Thanks ', fr: '', ar: '' } }).quote,
    ).toEqual({ en: 'Thanks', fr: '', ar: '' });
  });
});
