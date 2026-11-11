import type { AzureMonitorOpenTelemetryOptions } from '@azure/monitor-opentelemetry';
import type { Span } from '@opentelemetry/api';
import type { IncomingMessage } from 'node:http';
import { TELEMETRY_SAMPLING } from '@iconbridge/shared/telemetry';
import { isProbe, URL_ATTRIBUTES, withoutQuery } from './redact.js';

function stripQuery(span: Span): void {
  const attributes = (span as unknown as { attributes?: Record<string, unknown> }).attributes;
  for (const key of URL_ATTRIBUTES) {
    const value = withoutQuery(key, attributes?.[key]);
    if (value !== undefined) {
      span.setAttribute(key, value);
    }
  }
}

/**
 * Options of the Azure Monitor distro for the API (ADR-019, ADR-028). The instrumentation
 * options are those of the OpenTelemetry instrumentations, which the distro passes on
 * unchanged (its own type only lists the common ones).
 */
export function azureMonitorOptions(connectionString: string): AzureMonitorOpenTelemetryOptions {
  const http = {
    enabled: true,
    ignoreIncomingRequestHook: (request: IncomingMessage) => isProbe(request.url?.split('?')[0]),
    requestHook: stripQuery,
  };
  // Opening a pooled connection is not a query: those spans were a sixth of the volume.
  const postgreSql = { enabled: true, ignoreConnectSpans: true };
  return {
    azureMonitorExporterOptions: { connectionString },
    ...TELEMETRY_SAMPLING,
    // Business events (trackEvent) are kept even when their trace is sampled out.
    enableTraceBasedSamplingForLogs: false,
    enableLiveMetrics: false,
    instrumentationOptions: {
      http,
      postgreSql,
      azureSdk: { enabled: true },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
      // Logs stay in the container logs (Log Analytics); they are not copied as traces.
      bunyan: { enabled: false },
      winston: { enabled: false },
      console: { enabled: false },
    },
  };
}
