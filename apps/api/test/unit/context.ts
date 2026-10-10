import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@iconbridge/shared';
import type { AuthUser } from '../../src/auth/auth.types.js';

export function user(role: UserRole, overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: `${role.toLowerCase()}@example.test`,
    role,
    emailVerified: true,
    locale: 'en',
    ...overrides,
  };
}

export interface FakeRequest {
  method?: string;
  path?: string;
  user?: AuthUser;
  params?: Record<string, string>;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Execution context for guard tests; `metadata` is what the decorators would have set. */
export function contextFor(
  request: FakeRequest,
  metadata: Record<string, unknown> = {},
): { context: ExecutionContext; reflector: Reflector; request: FakeRequest } {
  const full = {
    method: 'GET',
    path: '/api/v1/things',
    params: {},
    cookies: {},
    headers: {},
    ...request,
  };
  const handler = () => undefined;
  const controller = function Controller() {
    return undefined;
  };
  const context = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => full }),
  } as unknown as ExecutionContext;
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
    (key: unknown) => metadata[String(key)],
  );
  return { context, reflector, request: full };
}
