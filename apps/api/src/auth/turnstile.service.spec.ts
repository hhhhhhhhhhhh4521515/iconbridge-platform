import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { TurnstileService } from './turnstile.service.js';

const TEST_SECRET = '1x0000000000000000000000000000000AA';

function service(secret: string, nodeEnv: Env['NODE_ENV'] = 'production') {
  const values: Record<string, string> = { TURNSTILE_SECRET_KEY: secret, NODE_ENV: nodeEnv };
  const instance = new TurnstileService({
    get: (key: string) => values[key],
  } as unknown as ConfigService<Env, true>);
  vi.spyOn(instance['logger'], 'error').mockImplementation(() => undefined);
  return instance;
}

describe('TurnstileService', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cloudflareSays = (body: unknown) =>
    fetchMock.mockResolvedValue({ json: () => Promise.resolve(body) });

  it('sends the secret, the token and the client IP to Cloudflare and accepts a success', async () => {
    cloudflareSays({ success: true });
    expect(await service('real-secret').verify('the-token', '203.0.113.7')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; body: URLSearchParams },
    ];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body)).toEqual({
      secret: 'real-secret',
      response: 'the-token',
      remoteip: '203.0.113.7',
    });
  });

  it('refuses when Cloudflare refuses or answers something unexpected', async () => {
    cloudflareSays({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await service('real-secret').verify('bad', null)).toBe(false);
    cloudflareSays({ success: 'true' });
    expect(await service('real-secret').verify('bad', null)).toBe(false);
    cloudflareSays(null);
    expect(await service('real-secret').verify('bad', null)).toBe(false);
  });

  it('fails closed when Cloudflare cannot be reached', async () => {
    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    expect(await service('real-secret').verify('token', null)).toBe(false);
  });

  it('does not call Cloudflare in development with the always-pass test secret', async () => {
    expect(await service(TEST_SECRET, 'development').verify('anything', null)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still calls Cloudflare in development with a real secret, and in production in every case', async () => {
    cloudflareSays({ success: false });
    expect(await service('real-secret', 'development').verify('token', null)).toBe(false);
    expect(await service(TEST_SECRET, 'production').verify('token', null)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
