import { describe, expect, it, vi } from 'vitest';
import { wakeApi } from './wake-api';

describe('wakeApi', () => {
  it('asks the API for its liveness, once', async () => {
    const send = vi.fn().mockResolvedValue(new Response('ok'));
    await wakeApi('http://ca-iconbridge-api-prod-itn', send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0])).toBe('http://ca-iconbridge-api-prod-itn/health/live');
  });

  it('never fails the start of the web app', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(wakeApi('http://api.internal', send)).resolves.toBeUndefined();
  });

  it('does nothing without a valid address', () => {
    const send = vi.fn();
    expect(wakeApi(undefined, send)).toBeUndefined();
    expect(wakeApi('not a url', send)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
