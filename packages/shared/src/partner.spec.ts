import { describe, expect, it } from 'vitest';
import { LOCALES, PARTNER_LOCALES } from './i18n.js';
import { PARTNER_WORK_PERMIT_STATUSES } from './enums.js';
import {
  createPartnerJobSchema,
  deletePartnerJobSchema,
  partnerJobIssues,
  createPartnerApplicationSchema,
  createPartnerLoginSchema,
  listPartnerApplicationsQuerySchema,
  partnerApplicationIssues,
  updatePartnerApplicationSchema,
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

describe('partner applications: the work permit', () => {
  const base = {
    jobId: '00000000-0000-4000-8000-000000000001',
    firstName: 'Anna',
    lastName: 'Nowak',
    nationality: 'PL',
  };

  it('has four statuses and starts at Not started', () => {
    expect([...PARTNER_WORK_PERMIT_STATUSES]).toEqual([
      'NOT_STARTED',
      'SUBMITTED',
      'APPROVED',
      'REFUSED',
    ]);
    expect(createPartnerApplicationSchema.parse(base)).toMatchObject({
      workPermitStatus: 'NOT_STARTED',
    });
  });

  it('accepts a submission date at any status', () => {
    for (const workPermitStatus of PARTNER_WORK_PERMIT_STATUSES) {
      expect(
        createPartnerApplicationSchema.safeParse({
          ...base,
          workPermitStatus,
          workPermitSubmittedDate: '2026-11-02',
        }).success,
        workPermitStatus,
      ).toBe(true);
    }
  });

  it('accepts a decision date only when Approved or Refused', () => {
    const verdict = (workPermitStatus: string) =>
      createPartnerApplicationSchema.safeParse({
        ...base,
        workPermitStatus,
        workPermitDecisionDate: '2026-11-10',
      }).success;
    expect(verdict('APPROVED')).toBe(true);
    expect(verdict('REFUSED')).toBe(true);
    expect(verdict('SUBMITTED')).toBe(false);
    expect(verdict('NOT_STARTED')).toBe(false);
    expect(
      createPartnerApplicationSchema.safeParse({ ...base, workPermitDecisionDate: '2026-11-10' })
        .success,
    ).toBe(false);
  });

  it('checks the rule on the merged state, independently of the visa', () => {
    expect(
      partnerApplicationIssues({
        workPermitStatus: 'APPROVED',
        workPermitDecisionDate: '2026-11-10',
      }),
    ).toEqual([]);
    expect(
      partnerApplicationIssues({
        workPermitStatus: 'SUBMITTED',
        workPermitDecisionDate: '2026-11-10',
      }).map((issue) => issue.path),
    ).toEqual(['workPermitDecisionDate']);
    expect(
      partnerApplicationIssues({
        visaStatus: 'APPROVED',
        workPermitDecisionDate: '2026-11-10',
      }).map((issue) => issue.path),
    ).toEqual(['workPermitDecisionDate']);
    expect(
      partnerApplicationIssues({ workPermitStatus: 'SUBMITTED', workPermitDecisionDate: null }),
    ).toEqual([]);
  });

  it('edits and filters by work permit status, and refuses an unknown one', () => {
    expect(updatePartnerApplicationSchema.parse({ workPermitStatus: 'SUBMITTED' })).toEqual({
      workPermitStatus: 'SUBMITTED',
    });
    expect(updatePartnerApplicationSchema.safeParse({ workPermitStatus: 'PENDING' }).success).toBe(
      false,
    );
    expect(listPartnerApplicationsQuerySchema.parse({ workPermitStatus: 'REFUSED' })).toEqual({
      workPermitStatus: 'REFUSED',
    });
    expect(
      listPartnerApplicationsQuerySchema.safeParse({ workPermitStatus: 'APPOINTMENT_BOOKED' })
        .success,
    ).toBe(false);
  });
});

describe('partner job demands: the salary (ADR-027, amendment 3)', () => {
  const job = { role: 'Cook', positions: 2, locations: ['Kraków'] };

  it('takes all three parts or none', () => {
    expect(createPartnerJobSchema.safeParse(job).success).toBe(true);
    expect(
      createPartnerJobSchema.safeParse({
        ...job,
        salaryAmount: 3000,
        salaryCurrency: 'PLN',
        salaryPeriod: 'MONTH',
      }).success,
    ).toBe(true);
    for (const half of [
      { salaryAmount: 3000 },
      { salaryAmount: 3000, salaryCurrency: 'PLN' },
      { salaryCurrency: 'PLN', salaryPeriod: 'MONTH' },
      { salaryPeriod: 'HOUR' },
    ]) {
      const parsed = createPartnerJobSchema.safeParse({ ...job, ...half });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(
        'The salary needs an amount, a currency and a period',
      );
    }
  });

  it('names the first missing part, and checks a merged state', () => {
    expect(
      partnerJobIssues({ salaryAmount: 1, salaryCurrency: 'EUR', salaryPeriod: null }),
    ).toEqual([
      { path: 'salaryPeriod', message: 'The salary needs an amount, a currency and a period' },
    ]);
    expect(
      partnerJobIssues({ salaryAmount: null, salaryCurrency: null, salaryPeriod: null }),
    ).toEqual([]);
  });

  it('refuses an amount of 0, a fraction and an unknown currency', () => {
    const full = { ...job, salaryCurrency: 'PLN', salaryPeriod: 'MONTH' };
    expect(createPartnerJobSchema.safeParse({ ...full, salaryAmount: 0 }).success).toBe(false);
    expect(createPartnerJobSchema.safeParse({ ...full, salaryAmount: 1.5 }).success).toBe(false);
    expect(createPartnerJobSchema.safeParse({ ...full, salaryAmount: 1 }).success).toBe(true);
    expect(
      createPartnerJobSchema.safeParse({ ...full, salaryAmount: 1, salaryCurrency: 'XYZ' }).success,
    ).toBe(false);
  });

  it('asks for the role to delete a job demand', () => {
    expect(deletePartnerJobSchema.safeParse({ confirmName: '  ' }).success).toBe(false);
    expect(deletePartnerJobSchema.parse({ confirmName: ' Cook ' })).toEqual({
      confirmName: 'Cook',
    });
  });
});
