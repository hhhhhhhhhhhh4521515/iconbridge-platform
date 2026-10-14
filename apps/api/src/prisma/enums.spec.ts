import {
  APPLICATION_STATUSES,
  DOCUMENT_TYPES,
  EDUCATION_LEVELS,
  EMAIL_STATUSES,
  EMAIL_TOKEN_TYPES,
  GENDERS,
  HISTORICAL_METRICS,
  JOB_STATUSES,
  LANGUAGE_LEVELS,
  SALARY_PERIODS,
  USER_ROLES,
} from '@iconbridge/shared';
import * as prismaEnums from '../generated/prisma/enums.js';

// The database enums and packages/shared must list the same values in the same order:
// the web app validates with the shared ones, the API stores the Prisma ones.
describe('Prisma enums match packages/shared', () => {
  it.each([
    ['UserRole', prismaEnums.UserRole, USER_ROLES],
    ['EmailTokenType', prismaEnums.EmailTokenType, EMAIL_TOKEN_TYPES],
    ['Gender', prismaEnums.Gender, GENDERS],
    ['EducationLevel', prismaEnums.EducationLevel, EDUCATION_LEVELS],
    ['LanguageLevel', prismaEnums.LanguageLevel, LANGUAGE_LEVELS],
    ['DocumentType', prismaEnums.DocumentType, DOCUMENT_TYPES],
    ['JobStatus', prismaEnums.JobStatus, JOB_STATUSES],
    ['SalaryPeriod', prismaEnums.SalaryPeriod, SALARY_PERIODS],
    ['ApplicationStatus', prismaEnums.ApplicationStatus, APPLICATION_STATUSES],
    ['HistoricalMetric', prismaEnums.HistoricalMetric, HISTORICAL_METRICS],
    ['EmailStatus', prismaEnums.EmailStatus, EMAIL_STATUSES],
  ] as const)('%s', (_name, prismaEnum, shared) => {
    expect(Object.values(prismaEnum)).toEqual([...shared]);
  });

  it('covers every enum of the schema', () => {
    expect(Object.keys(prismaEnums)).toHaveLength(11);
  });
});
