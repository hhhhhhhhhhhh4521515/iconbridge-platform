import { candidateProfileSchema } from '@iconbridge/shared/candidate';
import { registerSchema } from '@iconbridge/shared/auth';
import { describe, expect, it } from 'vitest';
import { refusedFields, safeNext, zodResolver } from './forms';

const run = async (resolver: ReturnType<typeof zodResolver>, values: Record<string, unknown>) =>
  (await resolver(values, undefined, {} as never)) as {
    values: Record<string, unknown>;
    errors: Record<
      string,
      { message?: string; root?: { message?: string }; other?: { message?: string } }
    >;
  };

describe('zodResolver', () => {
  const form = registerSchema.omit({ turnstileToken: true, locale: true });
  const valid = {
    email: ' Amira@Example.test ',
    password: 'a-long-enough-password',
    firstName: 'Amira',
    lastName: 'Ben Salah',
    phone: '+21620123456',
    country: 'TN',
    gdprConsent: true,
  };

  it('returns the parsed values when the form is valid', async () => {
    const result = await run(zodResolver(form), valid);
    expect(result.errors).toEqual({});
    expect(result.values.email).toBe('amira@example.test');
  });

  it('gives each wrong field a message key, never an English sentence', async () => {
    const { errors } = await run(zodResolver(form), {
      ...valid,
      email: 'nope',
      password: 'short',
      firstName: '',
      phone: null,
      gdprConsent: false,
    });
    expect(errors.email?.message).toBe('email');
    expect(errors.password?.message).toBe('tooShort:10');
    expect(errors.firstName?.message).toBe('required');
    expect(errors.phone?.message).toBe('required');
    expect(errors.gdprConsent?.message).toBe('required');
  });

  const profile = {
    firstName: 'Amira',
    lastName: 'Ben Salah',
    gender: null,
    dateOfBirth: null,
    nationality: null,
    countryOfResidence: null,
    city: null,
    phone: null,
    whatsapp: null,
    passportNumber: null,
    passportIssuingCountry: null,
    passportIssueDate: null,
    passportExpiryDate: null,
    currentProfession: null,
    yearsOfExperience: null,
    educationLevel: null,
    languages: [],
    drivingLicenceCategories: [],
    preferredDestinations: [],
    hasStcwTraining: false,
    hasSeamanBook: false,
    hasMedicalCertificate: false,
    seaExperience: null,
  };
  const step = (only: string[]) =>
    zodResolver(candidateProfileSchema, {
      prepare: (values) => ({ ...profile, passportExpiryDate: '2001-01-01', ...values }),
      only,
    });

  it('validates one step against the whole profile and translates the shared rules', async () => {
    const { errors } = await run(step(['dateOfBirth']), { dateOfBirth: '2020-01-01' });
    expect(errors.dateOfBirth?.message).toBe('minAge');
  });

  it('reports a rule broken in another step apart from the fields of this one', async () => {
    const { errors } = await run(step(['dateOfBirth']), { dateOfBirth: '1990-01-01' });
    expect(errors.dateOfBirth).toBeUndefined();
    expect(errors.root?.other?.message).toMatch(/^passport/);
  });

  it('keeps a problem on a whole list under "root"', async () => {
    const { errors } = await run(
      zodResolver(candidateProfileSchema, { prepare: (values) => ({ ...profile, ...values }) }),
      {
        languages: [
          { language: 'en', level: 'B2' },
          { language: 'en', level: 'C1' },
        ],
      },
    );
    expect(errors.languages?.root?.message).toBe('languageOnce');
  });
});

describe('safeNext', () => {
  it('accepts a path of the site', () => {
    expect(safeNext('/account/apply/welder?x=1', '/account')).toBe('/account/apply/welder?x=1');
  });
  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'account'])(
    'falls back for %s',
    (next) => {
      expect(safeNext(next, '/account')).toBe('/account');
    },
  );
});

describe('refusedFields', () => {
  it('lists the paths of a VALIDATION_ERROR', () => {
    expect(refusedFields([{ path: 'phone', message: 'x' }, { nope: 1 }, 'text'])).toEqual([
      'phone',
    ]);
    expect(refusedFields(undefined)).toEqual([]);
  });
});
