import { logs } from '@opentelemetry/api-logs';
import { isProbe, withoutQuery } from './redact.js';

describe('telemetry', () => {
  it('keeps the path of a URL, never its query string', () => {
    expect(withoutQuery('url.full', 'https://site/en/verify-email?token=secret')).toBe(
      'https://site/en/verify-email',
    );
    expect(withoutQuery('http.target', '/api/v1/jobs?q=welder')).toBe('/api/v1/jobs');
    expect(withoutQuery('url.query', 'token=secret')).toBe('');
    expect(withoutQuery('http.target', '/api/v1/jobs')).toBe('/api/v1/jobs');
    expect(withoutQuery('url.full', undefined)).toBeUndefined();
  });

  it('does not record health probes', () => {
    expect(isProbe('/health/live')).toBe(true);
    expect(isProbe('/health/ready')).toBe(true);
    expect(isProbe('/api/health/live')).toBe(true);
    expect(isProbe('/api/v1/jobs')).toBe(false);
    expect(isProbe('/healthy-jobs')).toBe(false);
    expect(isProbe(undefined)).toBe(false);
  });

  it('sends business events as custom events, without empty properties', async () => {
    const emit = vi.fn();
    vi.spyOn(logs, 'getLogger').mockReturnValue({ emit } as unknown as ReturnType<
      typeof logs.getLogger
    >);
    vi.resetModules();
    const { trackEvent } = await import('./events.js');
    trackEvent('status_changed', {
      applicationId: 'a1',
      from: 'SUBMITTED',
      to: 'SHORTLISTED',
      note: undefined,
    });
    expect(emit).toHaveBeenCalledWith({
      body: 'status_changed',
      attributes: {
        'microsoft.custom_event.name': 'status_changed',
        applicationId: 'a1',
        from: 'SUBMITTED',
        to: 'SHORTLISTED',
      },
    });
  });
});
