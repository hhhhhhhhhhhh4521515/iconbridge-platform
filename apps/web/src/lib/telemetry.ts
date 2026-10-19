import type { Span } from '@opentelemetry/api';
import type { IncomingMessage } from 'node:http';
import { isIgnoredPath, withoutQuery } from './telemetry-redact';

/** Attributes of HTTP spans that hold a URL or its query string. */
const URL_ATTRIBUTES = ['url.full', 'url.query', 'http.url', 'http.target', 'next.route'];

/**
 * Application Insights for the web server (requests, the calls to the API, exceptions),
 * started by instrumentation.ts when APPLICATIONINSIGHTS_CONNECTION_STRING is set (Azure).
 * Next.js creates the spans of its requests and fetch calls itself once a tracer exists.
 */
export async function startTelemetry(connectionString: string): Promise<void> {
  process.env['OTEL_SERVICE_NAME'] ??= 'iconbridge-web';
  // Renamed: despite its name it is not a React hook.
  const { useAzureMonitor: startAzureMonitor } = await import('@azure/monitor-opentelemetry');
  const stripQuery = (span: Span) => {
    const attributes = (span as unknown as { attributes?: Record<string, unknown> }).attributes;
    for (const key of URL_ATTRIBUTES) {
      const value = key === 'url.query' ? '' : withoutQuery(attributes?.[key]);
      if (value !== undefined && attributes?.[key] !== undefined) {
        span.setAttribute(key, value);
      }
    }
  };
  // Options of @opentelemetry/instrumentation-http, passed on by the distro.
  const http = {
    enabled: true,
    ignoreIncomingRequestHook: (request: IncomingMessage) =>
      isIgnoredPath(request.url?.split('?')[0]),
    requestHook: stripQuery,
  };
  startAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    tracesPerSecond: 5,
    enableLiveMetrics: false,
    instrumentationOptions: {
      http,
      azureSdk: { enabled: false },
      postgreSql: { enabled: false },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
      console: { enabled: false },
    },
  });
}
