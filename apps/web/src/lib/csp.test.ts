import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, createNonce, parseOrigins } from './csp';

describe('content security policy', () => {
  it('makes a different nonce every time', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    expect([...nonces][0]).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  const production = {
    development: false,
    https: true,
    mediaOrigins: ['https://media.blob.core.windows.net'],
  };

  it('lets only nonce-carrying scripts run in production: no inline, no eval', () => {
    const policy = contentSecurityPolicy('abc', production);
    const scripts = policy.split('; ').find((part) => part.startsWith('script-src')) ?? '';
    expect(scripts).toContain("'nonce-abc'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('upgrade-insecure-requests');
    expect(policy).toContain("img-src 'self' data: blob: https://media.blob.core.windows.net");
    expect(policy).not.toContain('localhost');
  });

  it('allows eval and websockets for the development server only, and upgrades only on https', () => {
    const policy = contentSecurityPolicy('abc', {
      development: true,
      https: false,
      mediaOrigins: ['http://localhost:10000'],
    });
    expect(policy).toContain('http://localhost:10000');
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('keeps only real origins from the configuration', () => {
    expect(
      parseOrigins(
        "https://*.blob.core.windows.net, http://localhost:10000  'unsafe-inline' javascript:x https://a.example/path",
      ),
    ).toEqual(['https://*.blob.core.windows.net', 'http://localhost:10000']);
    expect(parseOrigins(undefined)).toEqual([]);
  });
});
