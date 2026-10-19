// Loaded before the API with `node --import ./dist/telemetry/telemetry.js dist/main.js`
// (Dockerfile): instrumentation must be in place before express, its http server and pg
// are required. The ESM loader hook of OpenTelemetry is not used: it doubled the start-up
// on 0.5 vCPU (ADR-019). Without APPLICATIONINSIGHTS_CONNECTION_STRING (locally, in
// tests) nothing is started.
import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import type { Span } from '@opentelemetry/api';
import type { IncomingMessage } from 'node:http';
import { isProbe, URL_ATTRIBUTES, withoutQuery } from './redact.js';

const connectionString = process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];

if (connectionString) {
  // The cloud role name shown in Application Insights.
  process.env['OTEL_SERVICE_NAME'] ??= 'iconbridge-api';
  const stripQuery = (span: Span) => {
    const attributes = (span as unknown as { attributes?: Record<string, unknown> }).attributes;
    for (const key of URL_ATTRIBUTES) {
      const value = withoutQuery(key, attributes?.[key]);
      if (value !== undefined) {
        span.setAttribute(key, value);
      }
    }
  };
  // Options of @opentelemetry/instrumentation-http, which the distro passes on unchanged
  // (its own type only lists the common ones).
  const http = {
    enabled: true,
    ignoreIncomingRequestHook: (request: IncomingMessage) => isProbe(request.url?.split('?')[0]),
    requestHook: stripQuery,
  };
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    // Never more than 5 traces a second; at this site's traffic, everything is kept.
    tracesPerSecond: 5,
    enableLiveMetrics: false,
    instrumentationOptions: {
      http,
      postgreSql: { enabled: true },
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
  });
}
