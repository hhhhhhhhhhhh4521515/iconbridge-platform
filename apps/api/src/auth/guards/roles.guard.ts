import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { READ_ONLY_ROLES, type UserRole } from '@iconbridge/shared';
import { ADMIN_PATH } from '../../app.constants.js';
import { AppException, forbidden, unauthenticated } from '../../common/errors/app.exception.js';
import type { RequestWithUser } from '../auth.types.js';
import {
  ALLOW_PASSWORD_CHANGE_KEY,
  IS_PUBLIC_KEY,
  OPTIONAL_AUTH_KEY,
  ROLES_KEY,
  SELF_SERVICE_KEY,
} from '../decorators/index.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isAdminPath(path: string): boolean {
  return path === ADMIN_PATH || path.startsWith(`${ADMIN_PATH}/`);
}

/**
 * Global guard, after JwtAuthGuard. On top of the @Roles() lists it applies
 * four rules that do not depend on a decorator being remembered:
 * 1. a user who must replace a password chosen by a super admin reaches nothing but the
 *    routes marked @AllowPasswordChange() (ADR-024);
 * 2. a candidate never reaches a route under /admin;
 * 3. a route under /admin without @Roles() is refused to everybody;
 * 4. a read-only role (VIEWER) never performs a write, unless the route is @SelfService().
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean | undefined>(OPTIONAL_AUTH_KEY, targets)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw unauthenticated();
    }

    if (
      user.passwordChangeRequired &&
      !this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_PASSWORD_CHANGE_KEY, targets)
    ) {
      throw new AppException(
        'PASSWORD_CHANGE_REQUIRED',
        HttpStatus.FORBIDDEN,
        'Choose a new password first',
      );
    }

    const roles = this.reflector.getAllAndOverride<readonly UserRole[] | undefined>(
      ROLES_KEY,
      targets,
    );
    const adminRoute = isAdminPath(request.path);

    if (adminRoute && (user.role === 'CANDIDATE' || !roles)) {
      throw forbidden();
    }
    if (roles && !roles.includes(user.role)) {
      throw forbidden();
    }

    const isWrite = !SAFE_METHODS.has(request.method.toUpperCase());
    const readOnly = (READ_ONLY_ROLES as readonly UserRole[]).includes(user.role);
    if (
      isWrite &&
      readOnly &&
      !this.reflector.getAllAndOverride<boolean | undefined>(SELF_SERVICE_KEY, targets)
    ) {
      throw forbidden('This account is read only');
    }
    return true;
  }
}
