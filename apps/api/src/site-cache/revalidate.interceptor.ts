import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import { SiteCacheService, type SiteCacheTag } from './site-cache.service.js';

const REVALIDATES_KEY = 'site-cache:tags';

/**
 * On a controller or a route of the back office: after a successful write, the
 * public site drops these groups of cached data. Reads (GET) never do.
 */
export const Revalidates = (...tags: SiteCacheTag[]) => SetMetadata(REVALIDATES_KEY, tags);

@Injectable()
export class RevalidateInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly siteCache: SiteCacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tags = this.reflector.getAllAndOverride<SiteCacheTag[] | undefined>(REVALIDATES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const method = context.switchToHttp().getRequest<Request>().method;
    if (!tags || method === 'GET' || method === 'HEAD') {
      return next.handle();
    }
    return next.handle().pipe(
      tap(() => {
        this.siteCache.invalidate(tags);
      }),
    );
  }
}
