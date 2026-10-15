import { EMAIL_PRIORITY, HALF_QUOTA_TEMPLATES, halfQuotaCap } from './mail-priority.js';
import { EMAIL_TEMPLATES } from './mail.templates.js';

describe('email priorities', () => {
  const withPriority = (priority: number) =>
    EMAIL_TEMPLATES.filter((template) => EMAIL_PRIORITY[template] === priority).sort();

  it('puts account access first: verification, password reset, invitation', () => {
    expect(withPriority(1)).toEqual(
      ['account-exists', 'invitation', 'reset-password', 'verify-email'].sort(),
    );
  });

  it('puts the emails about applications second', () => {
    expect(withPriority(2)).toEqual(
      expect.arrayContaining([
        'application-received',
        'application-status',
        'application-status-correction',
      ]),
    );
  });

  it('puts job alerts and recruiter notices last', () => {
    expect(withPriority(3)).toEqual(
      expect.arrayContaining(['job-alert', 'new-application', 'contact-message']),
    );
  });

  it('gives every template a priority', () => {
    expect(EMAIL_TEMPLATES.every((template) => [1, 2, 3].includes(EMAIL_PRIORITY[template]))).toBe(
      true,
    );
  });

  it('caps job alerts at half the hourly quota, and not without a quota', () => {
    expect(HALF_QUOTA_TEMPLATES).toEqual(['job-alert']);
    expect(halfQuotaCap(10)).toBe(5);
    expect(halfQuotaCap(3)).toBe(1);
    expect(halfQuotaCap(0)).toBeNull();
  });
});
