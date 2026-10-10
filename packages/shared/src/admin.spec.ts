import { describe, expect, it } from 'vitest';
import {
  allowedApplicationTransitions,
  canTransitionApplication,
  createHomeSlideSchema,
  DEFAULT_EXPORT_COLUMNS,
  exportApplicationsSchema,
  publicStoryName,
} from './admin.js';
import { APPLICATION_PIPELINE, APPLICATION_STATUSES, USER_ROLES } from './enums.js';

describe('application state machine', () => {
  it('moves one step forward along the pipeline, or to Rejected', () => {
    for (const [index, status] of APPLICATION_PIPELINE.entries()) {
      const next = APPLICATION_PIPELINE[index + 1];
      if (status === 'DEPLOYED') continue;
      expect(allowedApplicationTransitions(status, 'RECRUITER')).toEqual([next, 'REJECTED']);
    }
  });

  it('walks Submitted -> ... -> Deployed in eight steps', () => {
    let status: (typeof APPLICATION_STATUSES)[number] = 'SUBMITTED';
    const path: string[] = [status];
    while (status !== 'DEPLOYED') {
      const [next] = allowedApplicationTransitions(status, 'RECRUITER');
      if (!next) throw new Error(`Stuck at ${status}`);
      status = next;
      path.push(status);
    }
    expect(path).toEqual([...APPLICATION_PIPELINE]);
  });

  it('cannot jump: Submitted to Visa approved, or any step skipped', () => {
    expect(canTransitionApplication('SUBMITTED', 'VISA_APPROVED', 'SUPER_ADMIN')).toBe(false);
    for (const [fromIndex, from] of APPLICATION_PIPELINE.entries()) {
      for (const [toIndex, to] of APPLICATION_PIPELINE.entries()) {
        const allowed = canTransitionApplication(from, to, 'SUPER_ADMIN');
        expect([from, to, allowed]).toEqual([from, to, toIndex === fromIndex + 1]);
      }
    }
  });

  it('cannot go backwards or stay in place', () => {
    expect(canTransitionApplication('INTERVIEW', 'SHORTLISTED', 'SUPER_ADMIN')).toBe(false);
    expect(canTransitionApplication('OFFER', 'OFFER', 'SUPER_ADMIN')).toBe(false);
  });

  it('treats Deployed as final for everybody', () => {
    for (const role of USER_ROLES) {
      expect(allowedApplicationTransitions('DEPLOYED', role)).toEqual([]);
    }
  });

  it.each(['REJECTED', 'WITHDRAWN'] as const)(
    '%s is final, except that a super admin can reopen it',
    (status) => {
      expect(allowedApplicationTransitions(status, 'RECRUITER')).toEqual([]);
      expect(allowedApplicationTransitions(status, 'SUPER_ADMIN')).toEqual(['UNDER_REVIEW']);
    },
  );

  it('never lets the back office set Withdrawn, or Submitted', () => {
    for (const from of APPLICATION_STATUSES) {
      for (const role of USER_ROLES) {
        expect(canTransitionApplication(from, 'WITHDRAWN', role)).toBe(false);
        expect(canTransitionApplication(from, 'SUBMITTED', role)).toBe(false);
      }
    }
  });

  it('gives candidates and viewers no transition at all', () => {
    for (const from of APPLICATION_STATUSES) {
      expect(allowedApplicationTransitions(from, 'CANDIDATE')).toEqual([]);
      expect(allowedApplicationTransitions(from, 'VIEWER')).toEqual([]);
    }
  });
});

describe('exportApplicationsSchema', () => {
  it('leaves the full passport number out by default', () => {
    const parsed = exportApplicationsSchema.parse({ format: 'csv' });
    expect(parsed.columns).toEqual(DEFAULT_EXPORT_COLUMNS);
    expect(parsed.columns).not.toContain('passportNumber');
    expect(parsed.columns).toContain('passportNumberMasked');
    expect(parsed.includeFullPassportNumber).toBe(false);
  });

  it('needs the column and the explicit flag together', () => {
    expect(
      exportApplicationsSchema.safeParse({ format: 'csv', columns: ['passportNumber'] }).success,
    ).toBe(false);
    expect(
      exportApplicationsSchema.safeParse({
        format: 'csv',
        columns: ['email'],
        includeFullPassportNumber: true,
      }).success,
    ).toBe(false);
    expect(
      exportApplicationsSchema.safeParse({
        format: 'xlsx',
        columns: ['email', 'passportNumber'],
        includeFullPassportNumber: true,
      }).success,
    ).toBe(true);
  });

  it('rejects unknown columns, formats and duplicates', () => {
    expect(exportApplicationsSchema.safeParse({ format: 'pdf' }).success).toBe(false);
    expect(
      exportApplicationsSchema.safeParse({ format: 'csv', columns: ['passwordHash'] }).success,
    ).toBe(false);
    expect(
      exportApplicationsSchema.safeParse({ format: 'csv', columns: ['email', 'email'] }).success,
    ).toBe(false);
  });
});

describe('publicStoryName', () => {
  it('shows the first name and the initial of the last name by default', () => {
    expect(
      publicStoryName({ firstName: 'Amira', lastName: 'Ben Salah', showFullName: false }),
    ).toBe('Amira B.');
    expect(publicStoryName({ firstName: 'Youssef', lastName: 'élu', showFullName: false })).toBe(
      'Youssef É.',
    );
  });

  it('shows the full name only with consent', () => {
    expect(publicStoryName({ firstName: 'Amira', lastName: 'Ben Salah', showFullName: true })).toBe(
      'Amira Ben Salah',
    );
  });

  it('shows the first name alone when there is no last name', () => {
    expect(publicStoryName({ firstName: 'Amira', lastName: ' ', showFullName: true })).toBe(
      'Amira',
    );
  });
});

describe('home slide links', () => {
  const title = { en: 'a', fr: 'b', ar: 'c' };
  it('accepts site paths and https URLs only', () => {
    for (const ctaUrl of ['/jobs?destination=MALTA', 'https://example.test/x']) {
      expect(createHomeSlideSchema.safeParse({ title, ctaUrl }).success).toBe(true);
    }
    for (const ctaUrl of ['javascript:alert(1)', 'http://example.test', '//evil.test', 'jobs']) {
      expect(createHomeSlideSchema.safeParse({ title, ctaUrl }).success).toBe(false);
    }
  });
});
