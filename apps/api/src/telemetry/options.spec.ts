import { azureMonitorOptions } from './options.js';

describe('Azure Monitor options of the API', () => {
  const options = azureMonitorOptions('InstrumentationKey=test');
  const instrumentations = options.instrumentationOptions as Record<
    string,
    Record<string, unknown>
  >;

  it('samples half of the traces by ratio and keeps every business event', () => {
    expect(options.samplingRatio).toBe(0.5);
    expect(options.tracesPerSecond).toBe(0);
    expect(options.enableTraceBasedSamplingForLogs).toBe(false);
  });

  it('keeps the standard metrics (5xx alert) and drops the performance counters', () => {
    expect(options.enableStandardMetrics).not.toBe(false);
    expect(options.enablePerformanceCounters).toBe(false);
  });

  it('records database queries but not the opening of pooled connections', () => {
    expect(instrumentations['postgreSql']).toEqual({ enabled: true, ignoreConnectSpans: true });
  });

  it('ignores health probes', () => {
    const ignore = instrumentations['http']?.['ignoreIncomingRequestHook'] as (request: {
      url?: string;
    }) => boolean;
    expect(ignore({ url: '/health/ready' })).toBe(true);
    expect(ignore({ url: '/api/v1/jobs?q=cook' })).toBe(false);
  });
});
