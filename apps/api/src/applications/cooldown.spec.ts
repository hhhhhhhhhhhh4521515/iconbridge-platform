import { isInCooldown, nextAllowedApplicationDate } from './cooldown.js';

const iso = (date: Date) => date.toISOString();
const at = (value: string) => new Date(value);

describe('nextAllowedApplicationDate', () => {
  it('adds calendar months and keeps the day and the time (example of the specification)', () => {
    expect(iso(nextAllowedApplicationDate(at('2026-03-12T09:30:00Z'), 6))).toBe(
      '2026-09-12T09:30:00.000Z',
    );
  });

  it('crosses a year', () => {
    expect(iso(nextAllowedApplicationDate(at('2026-10-10T16:00:00Z'), 6))).toBe(
      '2027-04-10T16:00:00.000Z',
    );
  });

  it('clamps to the last day of a shorter month', () => {
    expect(iso(nextAllowedApplicationDate(at('2026-08-31T12:00:00Z'), 6))).toBe(
      '2027-02-28T12:00:00.000Z',
    );
    expect(iso(nextAllowedApplicationDate(at('2027-08-31T12:00:00Z'), 6))).toBe(
      '2028-02-29T12:00:00.000Z',
    );
    expect(iso(nextAllowedApplicationDate(at('2026-05-31T12:00:00Z'), 1))).toBe(
      '2026-06-30T12:00:00.000Z',
    );
  });

  it('counts months, not 30-day periods', () => {
    const next = nextAllowedApplicationDate(at('2026-01-15T00:00:00Z'), 6);
    expect(iso(next)).toBe('2026-07-15T00:00:00.000Z');
    expect((next.getTime() - at('2026-01-15T00:00:00Z').getTime()) / 86_400_000).toBe(181);
  });

  it('works in UTC near midnight, whatever the server time zone', () => {
    expect(iso(nextAllowedApplicationDate(at('2026-03-31T23:30:00Z'), 6))).toBe(
      '2026-09-30T23:30:00.000Z',
    );
    expect(iso(nextAllowedApplicationDate(at('2026-04-01T00:30:00Z'), 6))).toBe(
      '2026-10-01T00:30:00.000Z',
    );
  });

  it('uses the configured number of months, and 0 means no waiting', () => {
    expect(iso(nextAllowedApplicationDate(at('2026-03-12T09:30:00Z'), 12))).toBe(
      '2027-03-12T09:30:00.000Z',
    );
    expect(iso(nextAllowedApplicationDate(at('2026-03-12T09:30:00Z'), 0))).toBe(
      '2026-03-12T09:30:00.000Z',
    );
  });
});

describe('isInCooldown', () => {
  const applied = at('2026-03-12T09:30:00Z');

  it('is true the same day and until the last millisecond before 6 months', () => {
    expect(isInCooldown(applied, 6, at('2026-03-12T09:30:01Z'))).toBe(true);
    expect(isInCooldown(applied, 6, at('2026-09-11T09:30:00Z'))).toBe(true); // 5 months 30 days
    expect(isInCooldown(applied, 6, at('2026-09-12T09:29:59.999Z'))).toBe(true);
  });

  it('is false exactly 6 months later, and after', () => {
    expect(isInCooldown(applied, 6, at('2026-09-12T09:30:00.000Z'))).toBe(false);
    expect(isInCooldown(applied, 6, at('2027-01-01T00:00:00Z'))).toBe(false);
  });

  it('is never true with a cooldown of 0 months', () => {
    expect(isInCooldown(applied, 0, applied)).toBe(false);
  });
});
