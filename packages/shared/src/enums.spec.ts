import { describe, expect, it } from 'vitest';
import {
  APPLICATION_EXIT_STATUSES,
  APPLICATION_PIPELINE,
  APPLICATION_STATUSES,
  applicationStatusSchema,
  destinationCodeSchema,
  isFinalApplicationStatus,
  userRoleSchema,
} from './enums.js';

describe('application statuses', () => {
  it('keeps the pipeline in the order of the specification', () => {
    expect(APPLICATION_PIPELINE).toEqual([
      'SUBMITTED',
      'UNDER_REVIEW',
      'SHORTLISTED',
      'INTERVIEW',
      'OFFER',
      'CONTRACT_SIGNED',
      'VISA_PROCESSING',
      'VISA_APPROVED',
      'DEPLOYED',
    ]);
  });

  it('has no duplicate and includes both exit statuses', () => {
    expect(new Set(APPLICATION_STATUSES).size).toBe(APPLICATION_STATUSES.length);
    expect(APPLICATION_STATUSES).toEqual(expect.arrayContaining([...APPLICATION_EXIT_STATUSES]));
  });

  it('treats only deployed, rejected and withdrawn as final', () => {
    const final = APPLICATION_STATUSES.filter(isFinalApplicationStatus);
    expect(final).toEqual(['DEPLOYED', 'REJECTED', 'WITHDRAWN']);
  });

  it('rejects an unknown status', () => {
    expect(applicationStatusSchema.safeParse('HIRED').success).toBe(false);
  });
});

describe('roles and destinations', () => {
  it('accepts the four account roles and nothing else', () => {
    expect(userRoleSchema.options).toEqual(['CANDIDATE', 'VIEWER', 'RECRUITER', 'SUPER_ADMIN']);
    expect(userRoleSchema.safeParse('VISITOR').success).toBe(false);
  });

  it('ships Malta, Poland and cruise ship', () => {
    expect(destinationCodeSchema.options).toEqual(['MALTA', 'POLAND', 'CRUISE_SHIP']);
  });
});
