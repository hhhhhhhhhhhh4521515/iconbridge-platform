import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@iconbridge/shared';
import { unauthenticated } from '../../common/errors/app.exception.js';
import type { AuthUser, RequestWithUser } from '../auth.types.js';

export const IS_PUBLIC_KEY = 'auth:public';
/** Opens a route to visitors: no access token is required or read. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const OPTIONAL_AUTH_KEY = 'auth:optional';
/**
 * Opens a route to visitors like @Public(), but still recognises a signed-in
 * user: the handler receives the user when the access token is valid, and
 * nothing otherwise. No 401 is ever returned.
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);

export const ROLES_KEY = 'auth:roles';
/**
 * Restricts a route (or a controller) to the given roles, usually a list from
 * PERMISSIONS in packages/shared. Without it any signed-in user is allowed,
 * except under /admin where a route without @Roles is refused.
 */
export const Roles = (...roles: readonly UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const REQUIRE_VERIFIED_EMAIL_KEY = 'auth:verified-email';
/** Refuses users whose email address is not verified yet (e.g. applying to a job). */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);

export const SELF_SERVICE_KEY = 'auth:self-service';
/** Marks a write that every signed-in role may do on its own account, including VIEWER. */
export const SelfService = () => SetMetadata(SELF_SERVICE_KEY, true);

export const ALLOW_PASSWORD_CHANGE_KEY = 'auth:allow-password-change';
/**
 * Keeps a route open to a user who must replace a password chosen by a super admin
 * (ADR-024). Every other authenticated route answers 403 PASSWORD_CHANGE_REQUIRED.
 */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

export const OWNED_RESOURCES = ['candidateProfile', 'document', 'application'] as const;
export type OwnedResource = (typeof OWNED_RESOURCES)[number];
export interface OwnershipRule {
  resource: OwnedResource;
  /** Route parameter that holds the resource id. */
  param: string;
}
export const OWNERSHIP_KEY = 'auth:ownership';
/** Used with OwnershipGuard: a candidate only reaches the resource if it is their own. */
export const Owned = (resource: OwnedResource, param = 'id') =>
  SetMetadata(OWNERSHIP_KEY, { resource, param } satisfies OwnershipRule);

/** The signed-in user. Throws 401 on a public route called without a session. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user) {
      throw unauthenticated();
    }
    return user;
  },
);
