import { z } from 'zod';

/** Account roles. Visitors are unauthenticated and have no role. */
export const USER_ROLES = ['CANDIDATE', 'VIEWER', 'RECRUITER', 'SUPER_ADMIN'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Roles that can sign in to the admin area. VIEWER is read only. */
export const ADMIN_ROLES = ['VIEWER', 'RECRUITER', 'SUPER_ADMIN'] as const satisfies UserRole[];

/**
 * Built-in destinations. Destinations live in a database table so admins can add
 * countries; these codes are the ones the platform ships with.
 */
export const DESTINATION_CODES = ['MALTA', 'POLAND', 'CRUISE_SHIP'] as const;
export const destinationCodeSchema = z.enum(DESTINATION_CODES);
export type DestinationCode = z.infer<typeof destinationCodeSchema>;

export const DESTINATION_LABELS: Record<DestinationCode, string> = {
  MALTA: 'Malta',
  POLAND: 'Poland',
  CRUISE_SHIP: 'Cruise ship',
};

export const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Pipeline statuses, in the order an application moves through them. */
export const APPLICATION_PIPELINE = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'SHORTLISTED',
  'INTERVIEW',
  'OFFER',
  'CONTRACT_SIGNED',
  'VISA_PROCESSING',
  'VISA_APPROVED',
  'DEPLOYED',
] as const;

/** Statuses that take an application out of the pipeline. */
export const APPLICATION_EXIT_STATUSES = ['REJECTED', 'WITHDRAWN'] as const;

export const APPLICATION_STATUSES = [
  ...APPLICATION_PIPELINE,
  ...APPLICATION_EXIT_STATUSES,
] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/** No further change is possible once an application is deployed, rejected or withdrawn. */
export function isFinalApplicationStatus(status: ApplicationStatus): boolean {
  return status === 'DEPLOYED' || status === 'REJECTED' || status === 'WITHDRAWN';
}

export const EMAIL_TOKEN_TYPES = ['VERIFY_EMAIL', 'RESET_PASSWORD'] as const;
export const emailTokenTypeSchema = z.enum(EMAIL_TOKEN_TYPES);
export type EmailTokenType = z.infer<typeof emailTokenTypeSchema>;

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export const genderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof genderSchema>;

/** Highest level completed, lowest first. */
export const EDUCATION_LEVELS = [
  'NONE',
  'PRIMARY',
  'SECONDARY',
  'VOCATIONAL',
  'BACHELOR',
  'MASTER',
  'DOCTORATE',
] as const;
export const educationLevelSchema = z.enum(EDUCATION_LEVELS);
export type EducationLevel = z.infer<typeof educationLevelSchema>;

/** CEFR levels, lowest first, then NATIVE. */
export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'] as const;
export const languageLevelSchema = z.enum(LANGUAGE_LEVELS);
export type LanguageLevel = z.infer<typeof languageLevelSchema>;

export const DOCUMENT_TYPES = [
  'CV',
  'PASSPORT',
  'PHOTO',
  'DIPLOMA',
  'CERTIFICATE',
  'STCW',
  'SEAMAN_BOOK',
  'MEDICAL',
  'OTHER',
] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const SALARY_PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export const salaryPeriodSchema = z.enum(SALARY_PERIODS);
export type SalaryPeriod = z.infer<typeof salaryPeriodSchema>;
