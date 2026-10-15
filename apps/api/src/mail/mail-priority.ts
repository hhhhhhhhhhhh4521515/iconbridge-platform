import type { EmailTemplate } from './mail.templates.js';

/**
 * Order in which the outbox hands emails to the mail service. The Azure-managed domain
 * accepts 10 emails an hour (ADR-014), so the quota goes to what somebody is waiting for:
 *
 * 1. account access: a person is on the site waiting for the link. `account-exists` is the
 *    answer to a registration with a known address; it must leave as fast as a
 *    verification email, or its delay would tell that the address has an account.
 * 2. applications and other emails a person is waiting for (job alert confirmation, the
 *    retention warning that comes before an erasure).
 * 3. bulk and staff: job alerts, notices to recruiters, contact messages for the team.
 */
export const EMAIL_PRIORITY = {
  'verify-email': 1,
  'reset-password': 1,
  invitation: 1,
  'account-exists': 1,
  'application-received': 2,
  'application-status': 2,
  'application-status-correction': 2,
  'job-alert-confirm': 2,
  'retention-warning': 2,
  'job-alert': 3,
  'new-application': 3,
  'contact-message': 3,
} as const satisfies Record<EmailTemplate, 1 | 2 | 3>;

/**
 * Templates that may use at most half of EMAIL_HOURLY_QUOTA in any 60 minutes, whatever
 * else is waiting: a job-alert batch never empties the quota of the hour.
 */
export const HALF_QUOTA_TEMPLATES: readonly EmailTemplate[] = ['job-alert'];

/** Most emails of HALF_QUOTA_TEMPLATES in 60 minutes; null when the quota is unknown (SMTP). */
export function halfQuotaCap(hourlyQuota: number): number | null {
  return hourlyQuota > 0 ? Math.floor(hourlyQuota / 2) : null;
}
