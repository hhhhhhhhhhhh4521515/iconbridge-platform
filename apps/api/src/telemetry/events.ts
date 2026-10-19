import { logs } from '@opentelemetry/api-logs';

/**
 * Business events sent to Application Insights (table AppEvents / customEvents). The
 * exporter turns a log record carrying `microsoft.custom_event.name` into a custom event.
 * Properties are ids and statuses only, never personal data. Without telemetry (locally,
 * in tests) the logger is a no-op.
 */
export type TelemetryEvent = 'application_submitted' | 'status_changed' | 'cooldown_blocked';

const logger = logs.getLogger('iconbridge-api');

export function trackEvent(
  name: TelemetryEvent,
  properties: Record<string, string | undefined> = {},
): void {
  const attributes: Record<string, string> = { 'microsoft.custom_event.name': name };
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      attributes[key] = value;
    }
  }
  logger.emit({ body: name, attributes });
}
