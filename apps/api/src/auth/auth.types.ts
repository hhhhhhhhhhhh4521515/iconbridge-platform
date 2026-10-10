import type { Locale, UserRole } from '@iconbridge/shared';
import type { Request } from 'express';

/** The signed-in user, loaded from the database on every request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  locale: Locale;
}

export type RequestWithUser = Request & { user?: AuthUser };

/** Where a request comes from; stored with sessions and audit entries. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(request: Request): RequestMeta {
  return {
    ip: request.ip ?? null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}
