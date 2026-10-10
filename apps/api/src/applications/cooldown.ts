import { UTCDate } from '@date-fns/utc';
import { addMonths } from 'date-fns';

/**
 * First moment a candidate may apply to the same job again: the date of the last
 * application plus N calendar months, computed in UTC so the result does not
 * depend on the server time zone. The day is kept (12 March -> 12 September) and
 * clamped to the end of a shorter month (31 August -> 28 or 29 February).
 */
export function nextAllowedApplicationDate(lastAppliedAt: Date, cooldownMonths: number): Date {
  return new Date(addMonths(new UTCDate(lastAppliedAt), cooldownMonths).getTime());
}

/** True while the cooldown runs. Applying is allowed again exactly at `nextAllowedAt`. */
export function isInCooldown(lastAppliedAt: Date, cooldownMonths: number, now: Date): boolean {
  return now.getTime() < nextAllowedApplicationDate(lastAppliedAt, cooldownMonths).getTime();
}
