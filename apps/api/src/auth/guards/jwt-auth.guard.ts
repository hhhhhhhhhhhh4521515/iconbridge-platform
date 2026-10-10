import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { localeSchema } from '@iconbridge/shared';
import { unauthenticated } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ACCESS_COOKIE } from '../auth.constants.js';
import type { AuthUser, RequestWithUser } from '../auth.types.js';
import { IS_PUBLIC_KEY } from '../decorators/index.js';
import { TokenService } from '../token.service.js';

/**
 * Global guard: every route needs a valid access token unless it is @Public().
 * The user is read from the database on each request, so a disabled account, a
 * role change or a forced logout takes effect immediately, not when the token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const payload = await this.tokens.verifyAccessToken(this.extractToken(request));
    if (!payload) {
      throw unauthenticated();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        locale: true,
        isActive: true,
        deletedAt: true,
        emailVerifiedAt: true,
        tokenVersion: true,
      },
    });
    if (!user || !user.isActive || user.deletedAt || user.tokenVersion !== payload.tv) {
      throw unauthenticated();
    }

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      locale: localeSchema.catch('en').parse(user.locale),
    } satisfies AuthUser;
    return true;
  }

  /** The cookie set at login, or a Bearer header for non-browser clients. */
  private extractToken(request: RequestWithUser): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const fromCookie = cookies?.[ACCESS_COOKIE];
    if (typeof fromCookie === 'string' && fromCookie) {
      return fromCookie;
    }
    const header = request.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  }
}
