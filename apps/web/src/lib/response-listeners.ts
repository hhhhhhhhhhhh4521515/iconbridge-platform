import { subscribe } from 'node:diagnostics_channel';
import { setMaxListeners, type EventEmitter } from 'node:events';

/**
 * Listener limit of each HTTP response of the web server, when telemetry runs.
 *
 * Next.js's rewrite proxy (`/api/v1/*` to the API) adds ten `close` listeners to every response
 * it forwards: the router, two request adapters, the proxy request and httpxy. The OpenTelemetry
 * HTTP instrumentation adds an eleventh, one over Node's default of 10, and Node then printed
 * MaxListenersExceededWarning for nearly every API call of the browser. The listeners belong to
 * that response and are released with it (measured: the heap stays flat over 3,000 calls), so
 * this is not a leak. The limit is raised for responses only; every other emitter keeps the
 * default and still warns on a real leak.
 */
export const RESPONSE_MAX_LISTENERS = 16;

/** Node publishes every incoming request here, with its response, before any handler runs. */
export const REQUEST_START_CHANNEL = 'http.server.request.start';

let subscribed = false;

export function raiseResponseListenerLimit(): void {
  if (subscribed) {
    return;
  }
  subscribed = true;
  subscribe(REQUEST_START_CHANNEL, (message) => {
    const { response } = message as { response?: EventEmitter };
    if (response) {
      setMaxListeners(RESPONSE_MAX_LISTENERS, response);
    }
  });
}
