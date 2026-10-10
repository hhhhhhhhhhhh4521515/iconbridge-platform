import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { concatMap, from, Observable } from 'rxjs';
import type { RequestWithUser } from '../../auth/auth.types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditSnapshotService, type AuditSnapshot } from './audit-snapshot.service.js';
import { AUDIT_KEY, type AuditOptions } from './audit.decorator.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function idFromResponse(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string') {
    return body.id;
  }
  return null;
}

/**
 * Global interceptor: every successful write by a back-office user (any role
 * except CANDIDATE) adds a row to audit_logs with the actor, the action, the
 * record, its state before and after, and the client IP.
 *
 * With @Audit() the entry is named and has snapshots. Without it the write is
 * still recorded, under "<METHOD> <route>". Failed requests are not recorded.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly snapshots: AuditSnapshotService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const actor = request.user;
    if (!actor || actor.role === 'CANDIDATE' || SAFE_METHODS.has(request.method.toUpperCase())) {
      return next.handle();
    }

    const options = this.reflector.get<AuditOptions | undefined>(AUDIT_KEY, context.getHandler());
    const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
    const action = options?.action ?? `${request.method.toUpperCase()} ${routePath}`;
    const entityType = options?.entityType ?? 'unknown';
    const paramId = this.param(request, options?.idParam ?? 'id');

    return from(this.snapshots.load(entityType, paramId)).pipe(
      concatMap((before) =>
        next.handle().pipe(
          concatMap(async (body: unknown) => {
            await this.record({
              actorId: actor.id,
              action,
              entityType,
              entityId: paramId ?? idFromResponse(body),
              before,
              ip: request.ip ?? null,
            });
            return body;
          }),
        ),
      ),
    );
  }

  private param(request: RequestWithUser, name: string): string | null {
    const value: unknown = request.params[name];
    return typeof value === 'string' ? value : null;
  }

  private async record(entry: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string | null;
    before: AuditSnapshot | null;
    ip: string | null;
  }): Promise<void> {
    try {
      const after = await this.snapshots.load(entry.entityType, entry.entityId);
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.before ?? undefined,
          after: after ?? undefined,
          ip: entry.ip,
        },
      });
    } catch (error) {
      // The change is already committed; losing the audit row must be loud but not undo it.
      this.logger.error(
        `Audit entry not written for ${entry.action}: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }
}
