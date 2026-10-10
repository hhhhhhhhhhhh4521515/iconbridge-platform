import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env-schema';

describe('parseWebEnv', () => {
  it('accepts an http(s) API URL and drops the trailing slash', () => {
    expect(parseWebEnv({ NEXT_PUBLIC_API_URL: 'http://localhost:4000/' })).toEqual({
      NEXT_PUBLIC_API_URL: 'http://localhost:4000',
    });
  });

  it('fails when the API URL is missing', () => {
    expect(() => parseWebEnv({})).toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it('fails when the API URL is not http(s)', () => {
    expect(() => parseWebEnv({ NEXT_PUBLIC_API_URL: 'ftp://example.test' })).toThrow(
      /NEXT_PUBLIC_API_URL/,
    );
  });
});
