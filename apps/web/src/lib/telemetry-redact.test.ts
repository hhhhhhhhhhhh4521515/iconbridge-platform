import { describe, expect, it } from 'vitest';
import { isIgnoredPath, withoutQuery } from './telemetry-redact';

describe('web telemetry', () => {
  it('drops the query string of a URL, where email links carry their token', () => {
    expect(withoutQuery('https://site/en/verify-email?token=secret')).toBe(
      'https://site/en/verify-email',
    );
    expect(withoutQuery('/en/jobs')).toBe('/en/jobs');
    expect(withoutQuery(3)).toBeUndefined();
  });

  it('ignores health probes and static files', () => {
    expect(isIgnoredPath('/api/health/live')).toBe(true);
    expect(isIgnoredPath('/api/health/ready')).toBe(true);
    expect(isIgnoredPath('/_next/static/chunks/main.js')).toBe(true);
    expect(isIgnoredPath('/en/jobs')).toBe(false);
    expect(isIgnoredPath('/api/v1/jobs')).toBe(false);
    expect(isIgnoredPath(undefined)).toBe(false);
  });
});
