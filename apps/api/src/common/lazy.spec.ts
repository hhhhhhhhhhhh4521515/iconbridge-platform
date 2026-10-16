import { lazy } from './lazy.js';

describe('lazy', () => {
  it('loads once, on the first call', async () => {
    const load = vi.fn().mockResolvedValue({ ready: true });
    const get = lazy(load);
    expect(load).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([get(), get()]);
    expect(first).toBe(second);
    await get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok');
    const get = lazy(load);
    await expect(get()).rejects.toThrow('offline');
    await expect(get()).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
