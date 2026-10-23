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
 * Keeps the request spans Next.js makes for health probes and static files out of
 * Application Insights. Next.js creates the span of each request itself (named after the
 * method, with `http.target`), so the HTTP instrumentation's ignore hook never sees it:
 * a probe every few seconds filled the workspace (111 rows in 20 minutes on 20 October
 * 2026). The distro takes no sampler object, so this span processor clears the "sampled"
 * flag when such a span starts, and when its parent's flag is clear: the exporting
 * processor, which runs after it, skips spans that are not sampled.
 */
export function probeFilterProcessor(parentFlags: (parentContext: unknown) => number | undefined): {
  onStart(span: StartedSpan, parentContext: unknown): void;
  onEnd(): void;
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
    onEnd() {},
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
