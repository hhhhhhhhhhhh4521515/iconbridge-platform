/**
 * Telemetry settings shared by the API and the web server (ADR-028).
 *
 * Both sample by trace id with the same ratio, so a page and the API calls it makes are
 * kept or dropped together. A dropped span is still recorded, so the standard metrics
 * (request and failure counts behind the 5xx alert) keep counting every request.
 */
export const TELEMETRY_SAMPLING = {
  /** Share of traces sent to Application Insights. */
  samplingRatio: 0.5,
  /** 0 selects the ratio sampler; a positive value would select the rate-limited one. */
  tracesPerSecond: 0,
  /** CPU and memory are in the Container Apps metrics already, at no ingestion cost. */
  enablePerformanceCounters: false,
} as const;
