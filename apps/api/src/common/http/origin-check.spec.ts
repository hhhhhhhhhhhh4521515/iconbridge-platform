import type { Request, Response } from 'express';
import { originCheck } from './origin-check.js';

function run(method: string, headers: Record<string, string>) {
  const check = originCheck(['https://jobs.example.test']);
  const next = vi.fn();
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const all: Record<string, string> = { host: 'api.example.test', ...headers };
  const request = {
    method,
    protocol: 'https',
    get: (name: string) => all[name.toLowerCase()],
  } as unknown as Request;
  check(request, { status } as unknown as Response, next);
  return {
    passed: next.mock.calls.length === 1,
    status: (status.mock.calls as unknown[][])[0]?.[0],
    json,
  };
}

describe('originCheck', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('never blocks %s, whatever the origin', (method) => {
    expect(run(method, { origin: 'https://evil.example' }).passed).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('lets %s from the web app through', (method) => {
    expect(run(method, { origin: 'https://jobs.example.test' }).passed).toBe(true);
  });

  it('lets through a request without Origin or Referer (not started by a page)', () => {
    expect(run('POST', {}).passed).toBe(true);
  });

  it('lets through the API calling itself (Swagger page)', () => {
    expect(run('POST', { origin: 'https://api.example.test' }).passed).toBe(true);
  });

  it.each([
    ['another site', { origin: 'https://evil.example' }],
    ['a look-alike host', { origin: 'https://jobs.example.test.evil.example' }],
    ['the same host over http', { origin: 'http://jobs.example.test' }],
    ['another port', { origin: 'https://jobs.example.test:8443' }],
    ['the "null" origin of a sandboxed page', { origin: 'null' }],
    ['another site known only by its Referer', { referer: 'https://evil.example/page' }],
  ])('refuses a state-changing request from %s', (_name, headers) => {
    const result = run('POST', headers);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
    expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('uses the Referer when there is no Origin', () => {
    expect(run('DELETE', { referer: 'https://jobs.example.test/fr/account' }).passed).toBe(true);
  });
});
