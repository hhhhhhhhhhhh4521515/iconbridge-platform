import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface AuditEntry {
  /** Null for the system (scheduled tasks). */
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ip?: string | null;
}

/**
 * Writes audit entries explicitly, for the cases the interceptor does not cover:
 * inside the transaction of the change, several records in one request, or
 * details such as the columns of an export. Never put a clear passport number,
 * a password hash or a token in `before` / `after`.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, client: Prisma.TransactionClient = this.prisma): Promise<void> {
    await client.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before ?? undefined,
        after: entry.after ?? undefined,
        ip: entry.ip ?? null,
      },
    });
  }
}
