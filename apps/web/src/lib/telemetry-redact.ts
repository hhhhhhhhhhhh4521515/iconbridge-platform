/**
 * What the web app's telemetry (Application Insights) leaves out. Query strings can carry
 * one-time tokens (email links: /verify-email?token=…); health probes run every few
 * seconds; static files are not worth a request row each.
 */
export function withoutQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const index = value.indexOf('?');
  return index === -1 ? value : value.slice(0, index);
}

export function isIgnoredPath(path: string | undefined): boolean {
  return (
    path !== undefined &&
    (/^\/api\/health(\/|$)/.test(path) || path.startsWith('/_next/') || path === '/favicon.ico')
  );
}

/** Just what the span processor reads of a span (`Span` of `@opentelemetry/sdk-trace`). */
interface StartedSpan {
  attributes: Record<string, unknown>;
  spanContext(): { traceFlags: number };
}

/**
 * The spans of Next.js worth a row: the request itself and its calls out (to the API).
 * Every other `next.span_type` (component tree, metadata, layout modules, start of the
 * response…) describes the rendering inside one request and filled `AppDependencies`.
 */
const KEPT_NEXT_SPANS = new Set(['BaseServer.handleRequest', 'AppRender.fetch']);

export function isInternalNextSpan(attributes: Record<string, unknown>): boolean {
  const type = attributes['next.span_type'];
  return typeof type === 'string' && !KEPT_NEXT_SPANS.has(type);
}

/**
 * Keeps the request spans Next.js makes for health probes and static files out of
 * Application Insights. Next.js creates the span of each request itself (named after the
 * method, with `http.target`), so the HTTP instrumentation's ignore hook never sees it:
 * a probe every few seconds filled the workspace (111 rows in 20 minutes on 20 October
 * 2026). The distro takes no sampler object, so this span processor clears the "sampled"
 * flag when such a span starts, and when its parent's flag is clear: the exporting
 * processor, which runs after it, skips spans that are not sampled.
 *
 * Internal rendering spans of Next.js are dropped the same way, but when they end, not when
 * they start: the spans started under them (the calls to the API) were sampled by then and
 * stay. The distro's own processor, which computes the request and dependency metrics, runs
 * before this one, so the metrics and the alerts on them are unchanged.
 */
export function probeFilterProcessor(parentFlags: (parentContext: unknown) => number | undefined): {
  onStart(span: StartedSpan, parentContext: unknown): void;
  onEnd(span: StartedSpan): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
} {
  const SAMPLED = 1; // TraceFlags.SAMPLED
  return {
    onStart(span, parentContext) {
      const flags = parentFlags(parentContext);
      const drop =
        flags === undefined
          ? isIgnoredPath(
              withoutQuery(span.attributes['http.target'] ?? span.attributes['url.path']),
            )
          : (flags & SAMPLED) === 0;
      if (drop) {
        const context = span.spanContext();
        context.traceFlags &= ~SAMPLED;
      }
    },
    onEnd(span) {
      if (isInternalNextSpan(span.attributes)) {
        const context = span.spanContext();
        context.traceFlags &= ~SAMPLED;
      }
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
