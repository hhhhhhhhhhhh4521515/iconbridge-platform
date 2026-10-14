import { describe, expect, it } from 'vitest';
import {
  adminCandidateListQuerySchema,
  allowedApplicationTransitions,
  bulkApplicationStatusSchema,
  bulkDeleteSchema,
  canTransitionApplication,
  contactMessageListQuerySchema,
  historicalFigureInputSchema,
  reorderSchema,
  updateHomeSlideSchema,
  updateSuccessStorySchema,
} from './admin.js';
import { applySchema, candidateProfileSchema, downloadQuerySchema } from './candidate.js';
import {
  APPLICATION_PIPELINE,
  APPLICATION_STATUSES,
  isGlobalHistoricalMetric,
  USER_ROLES,
} from './enums.js';
import { updateCategorySchema, updateDestinationSchema } from './jobs.js';
import { canDeleteRecords } from './permissions.js';
import { jobQuestionSchema } from './questions.js';

const ID = '00000000-0000-4000-8000-000000000000';
const OTHER = '00000000-0000-4000-8000-000000000001';
const label = { en: 'a', fr: 'b', ar: 'c' };

describe('application transitions: the whole matrix', () => {
  it.each(USER_ROLES.flatMap((role) => APPLICATION_STATUSES.map((from) => [role, from] as const)))(
    'as %s from %s',
    (role, from) => {
      const allowed = allowedApplicationTransitions(from, role);
      const staff = role === 'RECRUITER' || role === 'SUPER_ADMIN';
      const index = (APPLICATION_PIPELINE as readonly string[]).indexOf(from);
      const expected = !staff
        ? []
        : from === 'REJECTED' || from === 'WITHDRAWN'
          ? role === 'SUPER_ADMIN'
            ? ['UNDER_REVIEW']
            : []
          : from === 'DEPLOYED'
            ? []
            : [APPLICATION_PIPELINE[index + 1], 'REJECTED'];
      expect(allowed).toEqual(expected);
      for (const to of APPLICATION_STATUSES) {
        expect(canTransitionApplication(from, to, role)).toBe(allowed.includes(to));
      }
      // Never a jump over a step, never back to an earlier one, never to Withdrawn or Submitted.
      expect(allowed).not.toContain('WITHDRAWN');
      expect(allowed).not.toContain('SUBMITTED');
      expect(allowed).not.toContain(from);
    },
  );
});

describe('who may delete records', () => {
  it.each([
    ['SUPER_ADMIN', false, true],
    ['SUPER_ADMIN', true, true],
    ['RECRUITER', false, false],
    ['RECRUITER', true, true],
    ['VIEWER', true, false],
    ['CANDIDATE', true, false],
  ] as const)('%s with the recruiter setting %s: %s', (role, setting, expected) => {
    expect(canDeleteRecords(role, setting)).toBe(expected);
  });
});

describe('request rules', () => {
  it('refuses the same id twice in a bulk change, a deletion and a reordering', () => {
    expect(
      bulkApplicationStatusSchema.safeParse({ ids: [ID, ID], status: 'REJECTED' }).success,
    ).toBe(false);
    expect(
      bulkApplicationStatusSchema.safeParse({ ids: [ID, OTHER], status: 'REJECTED' }).success,
    ).toBe(true);
    expect(bulkDeleteSchema.safeParse({ ids: [ID, ID], reason: 'A reason' }).success).toBe(false);
    expect(bulkDeleteSchema.safeParse({ ids: [ID], reason: 'A reason' }).success).toBe(true);
    expect(bulkDeleteSchema.safeParse({ ids: [ID], reason: 'no' }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: [ID, ID] }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: [ID, OTHER] }).success).toBe(true);
  });

  it('refuses an update that changes nothing', () => {
    for (const schema of [
      updateSuccessStorySchema,
      updateHomeSlideSchema,
      updateDestinationSchema,
      updateCategorySchema,
    ]) {
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(updateSuccessStorySchema.safeParse({ firstName: 'Amira' }).success).toBe(true);
    expect(updateHomeSlideSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateDestinationSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateCategorySchema.safeParse({ name: label }).success).toBe(true);
  });

  it('reads "true" and "false" from a query string as booleans', () => {
    expect(adminCandidateListQuerySchema.parse({ active: 'false' }).active).toBe(false);
    expect(adminCandidateListQuerySchema.parse({ active: 'true' }).active).toBe(true);
    expect(contactMessageListQuerySchema.parse({ handled: 'true' }).handled).toBe(true);
    expect(contactMessageListQuerySchema.parse({}).handled).toBeUndefined();
    expect(downloadQuerySchema.parse({ inline: 'true' }).inline).toBe(true);
    expect(downloadQuerySchema.parse({}).inline).toBe(false);
    expect(downloadQuerySchema.safeParse({ inline: 'yes' }).success).toBe(false);
  });

  it('accepts at most 20 answers with an application', () => {
    const answers = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`q${String(index)}`, 'x']));
    const body = { documentIds: [ID], turnstileToken: 'ok' };
    expect(applySchema.safeParse({ ...body, answers: answers(20) }).success).toBe(true);
    expect(applySchema.safeParse({ ...body, answers: answers(21) }).success).toBe(false);
    expect(applySchema.safeParse({ ...body, documentIds: [ID, ID] }).success).toBe(false);
  });

  it('checks the age of a candidate against today when no date is given', () => {
    const profile = {
      firstName: 'A',
      lastName: 'B',
      gender: null,
      dateOfBirth: new Date().toISOString().slice(0, 10),
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
      hasStcwTraining: false,
      hasSeamanBook: false,
      hasMedicalCertificate: false,
      seaExperience: null,
    };
    expect(candidateProfileSchema.safeParse(profile).success).toBe(false);
    expect(
      candidateProfileSchema.safeParse({ ...profile, dateOfBirth: '1990-01-01' }).success,
    ).toBe(true);
  });
});

describe('historical figures', () => {
  it('knows which figures are global', () => {
    expect(isGlobalHistoricalMetric('PARTNER_COMPANIES')).toBe(true);
    expect(isGlobalHistoricalMetric('COUNTRIES_SERVED')).toBe(true);
    expect(isGlobalHistoricalMetric('VISAS_APPROVED')).toBe(false);
  });

  it.each([
    [{ metric: 'VISAS_APPROVED', year: 2024, destinationId: ID, value: 250 }, true],
    [{ metric: 'VISAS_APPROVED', year: 2024, destinationId: null, value: 250 }, false],
    [{ metric: 'VISAS_APPROVED', year: null, destinationId: ID, value: 250 }, false],
    [{ metric: 'PARTNER_COMPANIES', year: null, destinationId: null, value: 30 }, true],
    [{ metric: 'PARTNER_COMPANIES', year: 2024, destinationId: null, value: 30 }, false],
    [{ metric: 'COUNTRIES_SERVED', year: null, destinationId: ID, value: 3 }, false],
    [{ metric: 'VISAS_APPROVED', year: 1989, destinationId: ID, value: 1 }, false],
    [{ metric: 'VISAS_APPROVED', year: 2024, destinationId: ID, value: -1 }, false],
    [{ metric: 'VISAS_APPROVED', year: 2024, destinationId: ID, value: 1.5 }, false],
  ])('%j is valid: %s', (figure, valid) => {
    expect(historicalFigureInputSchema.safeParse(figure).success).toBe(valid);
  });
});

describe('questions of a job', () => {
  const option = (value: string) => ({ value, label });
  it.each([
    [{ id: 'q', type: 'TEXT', label, options: [option('a')] }, false],
    [{ id: 'q', type: 'YES_NO', label, options: [option('a'), option('b')] }, false],
    [{ id: 'q', type: 'SINGLE_CHOICE', label, options: [option('a')] }, false],
    [{ id: 'q', type: 'SINGLE_CHOICE', label, options: [option('a'), option('a')] }, false],
    [{ id: 'q', type: 'SINGLE_CHOICE', label, options: [option('a'), option('b')] }, true],
    [{ id: 'Q!', type: 'TEXT', label }, false],
    [{ id: 'q', type: 'TEXT', label }, true],
  ])('%j is valid: %s', (question, valid) => {
    expect(jobQuestionSchema.safeParse(question).success).toBe(valid);
  });
});
