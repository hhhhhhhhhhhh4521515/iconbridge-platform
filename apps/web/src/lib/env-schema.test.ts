import { describe, expect, it } from 'vitest';
import { parseWebEnv, TURNSTILE_TEST_SITE_KEY } from './env-schema';

const valid = {
  API_INTERNAL_URL: 'http://localhost:4000/',
  NEXT_PUBLIC_SITE_URL: 'https://jobs.example.test',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
};

describe('parseWebEnv', () => {
  it('accepts http(s) URLs and drops trailing slashes', () => {
    expect(parseWebEnv(valid)).toEqual({ ...valid, API_INTERNAL_URL: 'http://localhost:4000' });
  });

  it.each(Object.keys(valid))('fails when %s is missing', (name) => {
    const rest: Record<string, string> = { ...valid };
    delete rest[name];
    expect(() => parseWebEnv(rest)).toThrow(new RegExp(name));
  });

  it('fails when a URL is not http(s)', () => {
    expect(() => parseWebEnv({ ...valid, API_INTERNAL_URL: 'ftp://example.test' })).toThrow(
      /API_INTERNAL_URL/,
    );
  });

  it('recognises the Cloudflare test site keys', () => {
    expect(TURNSTILE_TEST_SITE_KEY.test('1x00000000000000000000AA')).toBe(true);
    expect(TURNSTILE_TEST_SITE_KEY.test('0x4AAAAAAABBBBBBBBBB')).toBe(false);
  });
});
