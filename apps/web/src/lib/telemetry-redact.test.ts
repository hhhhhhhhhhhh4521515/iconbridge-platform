import { describe, expect, it } from 'vitest';
import {
  isIgnoredPath,
  isInternalNextSpan,
  probeFilterProcessor,
  withoutQuery,
} from './telemetry-redact';

describe('web telemetry', () => {
  it('drops the query string of a URL, where email links carry their token', () => {
    expect(withoutQuery('https://site/en/verify-email?token=secret')).toBe(
      'https://site/en/verify-email',
    );
    expect(withoutQuery('/en/jobs')).toBe('/en/jobs');
    expect(withoutQuery(3)).toBeUndefined();
  });

  it('ignores health probes and static files', () => {
    expect(isIgnoredPath('/api/health/live')).toBe(true);
    expect(isIgnoredPath('/api/health/ready')).toBe(true);
    expect(isIgnoredPath('/_next/static/chunks/main.js')).toBe(true);
    expect(isIgnoredPath('/en/jobs')).toBe(false);
    expect(isIgnoredPath('/api/v1/jobs')).toBe(false);
    expect(isIgnoredPath(undefined)).toBe(false);
  });

  it('stops the request spans Next.js makes for health probes, and everything under them', () => {
    const span = (attributes: Record<string, unknown>) => {
      const context = { traceFlags: 1 };
      return { attributes, spanContext: () => context };
    };
    const sampled = (value: ReturnType<typeof span>) => (value.spanContext().traceFlags & 1) === 1;
    const flagsOf = new Map<string, number>([
      ['sampled parent', 1],
      ['dropped parent', 0],
    ]);
    const processor = probeFilterProcessor((context) => flagsOf.get(context as string));

    const probe = span({ 'http.method': 'GET', 'http.target': '/api/health/live' });
    processor.onStart(probe, 'root');
    expect(sampled(probe)).toBe(false);

    for (const attributes of [
      { 'http.target': '/api/health/ready?x=1' },
      { 'url.path': '/_next/static/chunks/main.js' },
    ]) {
      const other = span(attributes);
      processor.onStart(other, 'root');
      expect(sampled(other)).toBe(false);
    }

    const page = span({ 'http.target': '/en/jobs' });
    processor.onStart(page, 'root');
    expect(sampled(page)).toBe(true);

    const childOfProbe = span({});
    processor.onStart(childOfProbe, 'dropped parent');
    expect(sampled(childOfProbe)).toBe(false);

    const childOfPage = span({ 'http.target': '/api/health/live' });
    processor.onStart(childOfPage, 'sampled parent');
    expect(sampled(childOfPage)).toBe(true);
  });

  it('drops the internal rendering spans of Next.js when they end, and keeps the request and its calls (audit M5)', () => {
    expect(isInternalNextSpan({ 'next.span_type': 'BaseServer.handleRequest' })).toBe(false);
    expect(isInternalNextSpan({ 'next.span_type': 'AppRender.fetch' })).toBe(false);
    expect(isInternalNextSpan({ 'http.target': '/en/jobs' })).toBe(false);
    for (const type of [
      'NextNodeServer.createComponentTree',
      'ResolveMetadata.generateMetadata',
      'NextNodeServer.getLayoutOrPageModule',
      'AppRender.getBodyResult',
      'NextNodeServer.startResponse',
    ]) {
      expect(isInternalNextSpan({ 'next.span_type': type })).toBe(true);
    }

    const processor = probeFilterProcessor(() => 1);
    const span = (attributes: Record<string, unknown>) => {
      const context = { traceFlags: 1 };
      return { attributes, spanContext: () => context };
    };
    const render = span({ 'next.span_type': 'NextNodeServer.createComponentTree' });
    processor.onStart(render, 'sampled parent');
    // Still sampled while it runs: what starts under it (the fetch to the API) is kept.
    expect(render.spanContext().traceFlags & 1).toBe(1);
    const fetchSpan = span({ 'next.span_type': 'AppRender.fetch' });
    processor.onStart(fetchSpan, 'render');
    processor.onEnd(fetchSpan);
    processor.onEnd(render);
    expect(fetchSpan.spanContext().traceFlags & 1).toBe(1);
    expect(render.spanContext().traceFlags & 1).toBe(0);

    const request = span({ 'next.span_type': 'BaseServer.handleRequest', 'http.target': '/en' });
    processor.onEnd(request);
    expect(request.spanContext().traceFlags & 1).toBe(1);
  });
});
