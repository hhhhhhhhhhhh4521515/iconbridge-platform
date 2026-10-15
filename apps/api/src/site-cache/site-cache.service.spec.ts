import type { ConfigService } from '@nestjs/config';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { Env } from '../config/env.js';
import { REPEAT_NOTICE_MS, SiteCacheService } from './site-cache.service.js';

function setup(secret = 'r'.repeat(32)) {
  const values: Record<string, string> = {
    REVALIDATE_SECRET: secret,
    WEB_INTERNAL_URL: 'http://web.internal',
    WEB_ORIGIN: 'https://jobs.example.test',
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
  const catalog = { clearStatsCache: vi.fn() };
  const service = new SiteCacheService(config, catalog as unknown as CatalogService);
  return { service, catalog };
}

describe('SiteCacheService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('tells the web app at once, and again a moment later for pages rendered meanwhile', async () => {
    const { service } = setup();
    service.invalidate(['catalog', 'jobs']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://web.internal/api/revalidate',
      expect.objectContaining({ body: JSON.stringify({ tags: ['catalog', 'jobs'] }) }),
    );
    await vi.advanceTimersByTimeAsync(REPEAT_NOTICE_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map((call) => call[1] as RequestInit);
    expect(second?.body).toBe(first?.body);
    expect(second?.headers).toEqual(first?.headers);
  });

  it('clears the counters kept by the API when the stats change', () => {
    const { service, catalog } = setup();
    service.invalidate(['stats']);
    expect(catalog.clearStatsCache).toHaveBeenCalledTimes(1);
    service.invalidate(['slides']);
    expect(catalog.clearStatsCache).toHaveBeenCalledTimes(1);
  });

  it('tells nobody without a shared secret', async () => {
    const { service } = setup('');
    service.invalidate(['jobs']);
    await vi.advanceTimersByTimeAsync(REPEAT_NOTICE_MS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('survives a web app that cannot be reached', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('refused'), { name: 'TypeError' }));
    const { service } = setup();
    expect(() => {
      service.invalidate(['jobs']);
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(REPEAT_NOTICE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
