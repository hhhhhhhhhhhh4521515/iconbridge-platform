// Loaded before the API with `node --import ./dist/telemetry/telemetry.js dist/main.js`
// (Dockerfile): instrumentation must be in place before express, its http server and pg
// are required. The ESM loader hook of OpenTelemetry is not used: it doubled the start-up
// on 0.5 vCPU (ADR-019). Without APPLICATIONINSIGHTS_CONNECTION_STRING (locally, in
// tests) nothing is started.
import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import { azureMonitorOptions } from './options.js';

const connectionString = process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];

if (connectionString) {
  // The cloud role name shown in Application Insights.
  process.env['OTEL_SERVICE_NAME'] ??= 'iconbridge-api';
  useAzureMonitor(azureMonitorOptions(connectionString));
}
