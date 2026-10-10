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
