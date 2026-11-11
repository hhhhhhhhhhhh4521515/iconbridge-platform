import { describe, expect, it } from 'vitest';
import { TELEMETRY_SAMPLING } from './telemetry.js';

describe('telemetry sampling', () => {
  it('samples half of the traces by ratio, never by rate, without performance counters', () => {
    expect(TELEMETRY_SAMPLING).toEqual({
      samplingRatio: 0.5,
      tracesPerSecond: 0,
      enablePerformanceCounters: false,
    });
  });
});
