import { describe, expect, it } from 'vitest';
import {
  applySchema,
  canWithdrawApplication,
  DOCUMENT_FORMATS,
  isAtLeast,
  isPassportExpired,
  isPassportExpiringSoon,
  makeCandidateProfileSchema,
  profileCompleteness,
  REQUIRED_TO_APPLY,
} from './candidate.js';
import { COUNTRY_CODES, countryCodeSchema } from './countries.js';
import { APPLICATION_STATUSES, DOCUMENT_TYPES } from './enums.js';

const NOW = new Date('2026-10-10T12:00:00Z');
const schema = makeCandidateProfileSchema(() => NOW);

const complete = {
  firstName: 'Amira',
  lastName: 'Ben Salah',
  gender: 'FEMALE',
  dateOfBirth: '1995-04-12',
  nationality: 'TN',
  countryOfResidence: 'tn',
  city: 'Tunis',
  phone: '+21612345678',
  whatsapp: null,
  passportNumber: ' ab 1234567 ',
  passportIssuingCountry: 'TN',
  passportIssueDate: '2022-01-15',
  passportExpiryDate: '2032-01-14',
  currentProfession: 'Receptionist',
  yearsOfExperience: 4,
  educationLevel: 'BACHELOR',
  languages: [
    { language: 'AR', level: 'NATIVE' },
    { language: 'en', level: 'B2' },
  ],
  drivingLicenceCategories: ['b'],
  hasStcwTraining: false,
  hasSeamanBook: false,
  hasMedicalCertificate: false,
  seaExperience: null,
};

const empty = {
  ...Object.fromEntries(Object.keys(complete).map((key) => [key, null])),
  firstName: 'Amira',
  lastName: 'Ben Salah',
  languages: [],
  drivingLicenceCategories: [],
  hasStcwTraining: false,
  hasSeamanBook: false,
  hasMedicalCertificate: false,
};

const paths = (input: unknown) =>
  schema.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('country codes', () => {
  it('has the 249 assigned ISO 3166-1 alpha-2 codes, without duplicates', () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES]);
  });

  it('only contains codes the runtime knows as regions', () => {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const unknown = COUNTRY_CODES.filter((code) => {
      const name = names.of(code);
      return !name || name === code || name === 'Unknown Region';
    });
    expect(unknown).toEqual([]);
  });

  it('accepts lower case and rejects unassigned or malformed codes', () => {
    expect(countryCodeSchema.parse(' mt ')).toBe('MT');
    for (const bad of ['XX', 'ZZ', 'UK', 'EU', 'TUN', 'T', '']) {
      expect(countryCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('date rules', () => {
  it('is 18 on the birthday, not the day before', () => {
    expect(isAtLeast(18, '2008-10-10', '2026-10-10')).toBe(true);
    expect(isAtLeast(18, '2008-10-11', '2026-10-10')).toBe(false);
  });

  it('counts someone born on 29 February as 18 on 28 February of a common year', () => {
    expect(isAtLeast(18, '2008-02-29', '2026-02-27')).toBe(false);
    expect(isAtLeast(18, '2008-02-29', '2026-02-28')).toBe(true);
  });

  it('treats a passport as valid on its expiry date and expired the day after', () => {
    expect(isPassportExpired('2026-10-10', '2026-10-10')).toBe(false);
    expect(isPassportExpired('2026-10-09', '2026-10-10')).toBe(true);
  });

  it('warns when the passport expires within 6 months', () => {
    expect(isPassportExpiringSoon('2027-04-09', NOW)).toBe(true);
    expect(isPassportExpiringSoon('2027-04-10', NOW)).toBe(false);
    expect(isPassportExpiringSoon('2026-10-01', NOW)).toBe(false); // already expired: another rule
  });
});

describe('candidate profile schema', () => {
  it('accepts a complete profile and normalises it', () => {
    expect(schema.parse(complete)).toMatchObject({
      countryOfResidence: 'TN',
      passportNumber: 'AB1234567',
      languages: [
        { language: 'ar', level: 'NATIVE' },
        { language: 'en', level: 'B2' },
      ],
      drivingLicenceCategories: ['B'],
    });
  });

  it('accepts destination preferences and defaults them to none', () => {
    expect(schema.parse(complete).preferredDestinations).toEqual([]);
    expect(
      schema.parse({ ...complete, preferredDestinations: ['malta', ' CRUISE_SHIP '] })
        .preferredDestinations,
    ).toEqual(['MALTA', 'CRUISE_SHIP']);
  });

  it('accepts a profile with only the names', () => {
    expect(schema.safeParse(empty).success).toBe(true);
  });

  it('requires every field to be present, even when null', () => {
    const { city: _omitted, ...withoutCity } = complete;
    expect(paths(withoutCity)).toContain('city');
  });

  it.each([
    ['under 18', { dateOfBirth: '2008-10-11' }, 'dateOfBirth'],
    ['born in the future', { dateOfBirth: '2030-01-01' }, 'dateOfBirth'],
    ['an impossible date', { dateOfBirth: '1995-02-30' }, 'dateOfBirth'],
    ['an unknown nationality', { nationality: 'XX' }, 'nationality'],
    ['a country name instead of a code', { countryOfResidence: 'Tunisia' }, 'countryOfResidence'],
    ['a phone without country code', { phone: '0612345678' }, 'phone'],
    ['a WhatsApp number that is not E.164', { whatsapp: '+216 12 345 678' }, 'whatsapp'],
    ['an expired passport', { passportExpiryDate: '2026-10-09' }, 'passportExpiryDate'],
    ['a passport expiring today', { passportExpiryDate: '2026-10-10' }, 'passportExpiryDate'],
    ['a passport issued in the future', { passportIssueDate: '2026-10-11' }, 'passportIssueDate'],
    [
      'an expiry before the issue date',
      { passportIssueDate: '2026-06-01', passportExpiryDate: '2026-05-01' },
      'passportExpiryDate',
    ],
    ['a passport number with symbols', { passportNumber: 'AB-123/45' }, 'passportNumber'],
    ['a partial passport', { passportIssuingCountry: null }, 'passportNumber'],
    ['negative experience', { yearsOfExperience: -1 }, 'yearsOfExperience'],
    [
      'the same language twice',
      {
        languages: [
          { language: 'en', level: 'B1' },
          { language: 'EN', level: 'C1' },
        ],
      },
      'languages',
    ],
    [
      'an unknown language level',
      { languages: [{ language: 'en', level: 'FLUENT' }] },
      'languages.0.level',
    ],
    ['an empty first name', { firstName: '  ' }, 'firstName'],
  ])('rejects %s', (_case, overrides, path) => {
    expect(paths({ ...complete, ...overrides })).toContain(path);
  });

  it('accepts exactly 18 years old and a passport expiring tomorrow', () => {
    expect(schema.safeParse({ ...complete, dateOfBirth: '2008-10-10' }).success).toBe(true);
    expect(schema.safeParse({ ...complete, passportExpiryDate: '2026-10-11' }).success).toBe(true);
  });

  it('ignores fields a candidate must not set', () => {
    const parsed = schema.parse({
      ...complete,
      role: 'SUPER_ADMIN',
      gdprConsentAt: null,
      userId: 'x',
    });
    for (const key of ['role', 'gdprConsentAt', 'userId']) {
      expect(parsed).not.toHaveProperty(key);
    }
  });
});

describe('profileCompleteness', () => {
  const input = { ...complete, documentTypes: ['CV', 'PASSPORT'] as const };

  it('is 100% with every item and both required documents', () => {
    expect(profileCompleteness({ ...input, documentTypes: ['CV', 'PASSPORT'] })).toEqual({
      percentage: 100,
      missing: [],
      missingToApply: [],
    });
  });

  it('is 0% for a profile with only the names, and lists what blocks applying', () => {
    const result = profileCompleteness({ ...empty, languages: [], documentTypes: [] } as never);
    expect(result.percentage).toBe(0);
    expect(result.missing).toHaveLength(16);
    expect(result.missingToApply).toEqual([...REQUIRED_TO_APPLY]);
  });

  it('needs the CV and the passport scan to apply', () => {
    expect(
      profileCompleteness({ ...input, documentTypes: ['PASSPORT', 'PHOTO'] }).missingToApply,
    ).toEqual(['cvDocument']);
    expect(profileCompleteness({ ...input, documentTypes: ['CV'] }).missingToApply).toEqual([
      'passportDocument',
    ]);
  });

  it('does not block applying for optional items', () => {
    const result = profileCompleteness({
      ...input,
      city: null,
      gender: null,
      languages: [],
      documentTypes: ['CV', 'PASSPORT'],
    });
    expect(result.missing).toEqual(['gender', 'city', 'languages']);
    expect(result.missingToApply).toEqual([]);
    expect(result.percentage).toBe(81);
  });

  it('counts 0 years of experience as provided', () => {
    expect(
      profileCompleteness({ ...input, yearsOfExperience: 0, documentTypes: ['CV', 'PASSPORT'] })
        .missing,
    ).toEqual([]);
  });
});

describe('documents and applications', () => {
  it('accepts PDF and DOCX for a CV, scans for the rest, images only for the photo', () => {
    expect(DOCUMENT_FORMATS.CV).toEqual(['pdf', 'docx']);
    expect(DOCUMENT_FORMATS.PASSPORT).toEqual(['pdf', 'jpg', 'png']);
    expect(DOCUMENT_FORMATS.PHOTO).toEqual(['jpg', 'png']);
    expect(Object.keys(DOCUMENT_FORMATS).sort()).toEqual([...DOCUMENT_TYPES].sort());
  });

  it('allows withdrawing until the contract is signed', () => {
    expect(APPLICATION_STATUSES.filter(canWithdrawApplication)).toEqual([
      'SUBMITTED',
      'UNDER_REVIEW',
      'SHORTLISTED',
      'INTERVIEW',
      'OFFER',
    ]);
  });

  it('validates an application body', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(applySchema.safeParse({ documentIds: [id], turnstileToken: 't' }).success).toBe(true);
    expect(applySchema.safeParse({ documentIds: [], turnstileToken: 't' }).success).toBe(false);
    expect(applySchema.safeParse({ documentIds: [id, id], turnstileToken: 't' }).success).toBe(
      false,
    );
    expect(applySchema.safeParse({ documentIds: [id] }).success).toBe(false);
    expect(
      applySchema.parse({ documentIds: [id], turnstileToken: 't', status: 'OFFER' }),
    ).not.toHaveProperty('status');
  });
});
