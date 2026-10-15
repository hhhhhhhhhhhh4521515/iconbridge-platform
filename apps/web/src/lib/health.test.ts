import { describe, expect, it, vi } from 'vitest';
import { apiReadiness } from './health';

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
});
