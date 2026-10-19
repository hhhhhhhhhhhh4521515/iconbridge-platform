import { describe, expect, it, vi } from 'vitest';
import { apiReadiness, webVersion } from './health';

describe('apiReadiness', () => {
  it('asks /health/ready of the API, without cache', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await apiReadiness('http://api:4000', fetcher)).toEqual({ ready: true });
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://api:4000/health/ready');
    expect(init.cache).toBe('no-store');
  });

  it('is not ready when the API answers an error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    expect(await apiReadiness('http://api:4000', fetcher)).toEqual({ ready: false });
  });

  it('is not ready when the API cannot be reached or is too slow', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    expect(await apiReadiness('http://api:4000', fetcher)).toEqual({ ready: false });
    const slow = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('timeout', 'TimeoutError'));
          });
        }),
    );
    expect(await apiReadiness('http://api:4000', slow, 20)).toEqual({ ready: false });
  });

  it('is not ready without an API address', async () => {
    expect(await apiReadiness(undefined)).toEqual({ ready: false });
  });

  it('reads the commit the API runs from its answer', async () => {
    const body = { status: 'ok', version: 'abc1234', checks: { database: 'ok' } };
    const fetcher = vi.fn().mockResolvedValue(Response.json(body));
    expect(await apiReadiness('http://api:4000', fetcher)).toEqual({
      ready: true,
      version: 'abc1234',
    });
  });

  it('stays ready with an older API that does not say its version', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }));
    expect(await apiReadiness('http://api:4000', fetcher)).toEqual({ ready: true });
  });
});

describe('webVersion', () => {
  it('is the commit of the image, or "dev" outside one', () => {
    expect(webVersion({ APP_VERSION: 'abc1234' })).toBe('abc1234');
    expect(webVersion({})).toBe('dev');
    expect(webVersion({ APP_VERSION: '' })).toBe('dev');
  });
});
