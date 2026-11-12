import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import type { PartnerMemberKind } from '@iconbridge/shared';
import { z } from 'zod';
import type { RequestWithUser } from '../auth/auth.types.js';
import { PARTNER_SPACE_KEY, PartnerAccess } from '../auth/decorators/index.js';
import { notFound, unauthenticated } from '../common/errors/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The space of the path, once the guard has found the caller a member of it. */
export interface PartnerSpaceContext {
  id: string;
  membership: PartnerMemberKind;
}

type RequestInSpace = RequestWithUser & { partnerSpace?: PartnerSpaceContext };

const spaceNotFound = () => notFound('Partner space not found');

/**
 * The door of every route under /partner-spaces/:spaceId (ADR-027). On each request it reads
 * the caller's membership and the space's state: a non-member, a removed member, a disabled
 * space or an unknown id all answer 404, the same answer. It runs after JwtAuthGuard, which has
 * already refused a disabled login. Services still put the space id in every query.
 */
@Injectable()
export class PartnerSpaceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestInSpace>();
    const user = request.user;
    if (!user) {
      throw unauthenticated();
    }
    const spaceId = z.uuid().safeParse(request.params['spaceId']);
    if (!spaceId.success) {
      throw spaceNotFound();
    }
    const member = await this.prisma.partnerSpaceMember.findFirst({
      where: { partnerSpaceId: spaceId.data, userId: user.id, space: { isActive: true } },
      select: { kind: true },
    });
    if (!member) {
      throw spaceNotFound();
    }
    // A partner login must be of the PARTNER kind, and a staff account of the STAFF kind.
    if ((member.kind === 'PARTNER') !== (user.role === 'PARTNER')) {
      throw spaceNotFound();
    }
    request.partnerSpace = { id: spaceId.data, membership: member.kind };
    return true;
  }
}

/**
 * Marks a route of the partner area: open to partner logins, behind PartnerSpaceGuard, and a
 * write for every member alike, viewers included (ADR-027, answer 2).
 */
export const PartnerSpaceRoute = () =>
  applyDecorators(
    PartnerAccess(),
    SetMetadata(PARTNER_SPACE_KEY, true),
    UseGuards(PartnerSpaceGuard),
  );

/** The space found by PartnerSpaceGuard; only on routes marked @PartnerSpaceRoute(). */
export const CurrentSpace = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PartnerSpaceContext => {
    const space = context.switchToHttp().getRequest<RequestInSpace>().partnerSpace;
    if (!space) {
      throw new Error('CurrentSpace needs @PartnerSpaceRoute() on the route');
    }
    return space;
  },
);
