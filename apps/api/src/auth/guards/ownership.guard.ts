import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { notFound, unauthenticated } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RequestWithUser } from '../auth.types.js';
import { OWNERSHIP_KEY, type OwnedResource, type OwnershipRule } from '../decorators/index.js';

/**
 * Use with @Owned(resource, param): a candidate reaches a profile, a document or
 * an application only if it is their own. Somebody else's resource answers 404,
 * like a missing one, so ids cannot be probed. Back-office roles pass: what they
 * may do is decided by @Roles().
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<OwnershipRule | undefined>(OWNERSHIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) {
      throw new Error('OwnershipGuard needs @Owned() on the route');
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw unauthenticated();
    }
    if (user.role !== 'CANDIDATE') {
      return true;
    }

    const id = z.uuid().safeParse(request.params[rule.param]);
    if (!id.success) {
      throw notFound();
    }
    const ownerId = await this.ownerOf(rule.resource, id.data);
    if (ownerId !== user.id) {
      throw notFound();
    }
    return true;
  }

  /** User id of the candidate who owns the resource, or null when it does not exist. */
  private async ownerOf(resource: OwnedResource, id: string): Promise<string | null> {
    switch (resource) {
      case 'candidateProfile': {
        const profile = await this.prisma.candidateProfile.findUnique({
          where: { id },
          select: { userId: true },
        });
        return profile?.userId ?? null;
      }
      case 'document': {
        const document = await this.prisma.document.findUnique({
          where: { id },
          select: { candidate: { select: { userId: true } } },
        });
        return document?.candidate.userId ?? null;
      }
      case 'application': {
        const application = await this.prisma.application.findUnique({
          where: { id },
          select: { candidate: { select: { userId: true } } },
        });
        return application?.candidate.userId ?? null;
      }
    }
  }
}
