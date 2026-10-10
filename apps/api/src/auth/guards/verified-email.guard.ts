import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/errors/app.exception.js';
import type { RequestWithUser } from '../auth.types.js';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/index.js';

/** Global guard: routes marked @RequireVerifiedEmail() refuse users with an unverified address. */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_VERIFIED_EMAIL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user?.emailVerified) {
      throw new AppException(
        'EMAIL_NOT_VERIFIED',
        HttpStatus.FORBIDDEN,
        'Verify your email address first',
      );
    }
    return true;
  }
}
