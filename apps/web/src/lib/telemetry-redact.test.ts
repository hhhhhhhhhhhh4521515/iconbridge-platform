import { describe, expect, it } from 'vitest';
import { isIgnoredPath, probeFilterProcessor, withoutQuery } from './telemetry-redact';

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

  it('stops the request spans Next.js makes for health probes, and everything under them', () => {
    const span = (attributes: Record<string, unknown>) => {
      const context = { traceFlags: 1 };
      return { attributes, spanContext: () => context };
    };
    const sampled = (value: ReturnType<typeof span>) => (value.spanContext().traceFlags & 1) === 1;
    const flagsOf = new Map<string, number>([
      ['sampled parent', 1],
      ['dropped parent', 0],
    ]);
    const processor = probeFilterProcessor((context) => flagsOf.get(context as string));

    const probe = span({ 'http.method': 'GET', 'http.target': '/api/health/live' });
    processor.onStart(probe, 'root');
    expect(sampled(probe)).toBe(false);

    for (const attributes of [
      { 'http.target': '/api/health/ready?x=1' },
      { 'url.path': '/_next/static/chunks/main.js' },
    ]) {
      const other = span(attributes);
      processor.onStart(other, 'root');
      expect(sampled(other)).toBe(false);
    }

    const page = span({ 'http.target': '/en/jobs' });
    processor.onStart(page, 'root');
    expect(sampled(page)).toBe(true);

    const childOfProbe = span({});
    processor.onStart(childOfProbe, 'dropped parent');
    expect(sampled(childOfProbe)).toBe(false);

    const childOfPage = span({ 'http.target': '/api/health/live' });
    processor.onStart(childOfPage, 'sampled parent');
    expect(sampled(childOfPage)).toBe(true);
  });
});
