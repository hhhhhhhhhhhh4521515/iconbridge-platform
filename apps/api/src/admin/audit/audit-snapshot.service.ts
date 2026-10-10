import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';

export type AuditSnapshot = Record<string, string | number | boolean | null>;

/**
 * Reads the state of a record for the audit log. Each loader selects the fields
 * worth keeping, and nothing secret: no password hash, no token, no passport number.
 */
@Injectable()
export class AuditSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly loaders: Record<string, (id: string) => Promise<AuditSnapshot | null>> = {
    user: async (id) => {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          locale: true,
          tokenVersion: true,
          emailVerifiedAt: true,
          deletedAt: true,
        },
      });
      return user
        ? {
            ...user,
            emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
            deletedAt: user.deletedAt?.toISOString() ?? null,
          }
        : null;
    },
  };

  /** Null for an unknown entity type, an id that is not a UUID, or a missing record. */
  async load(entityType: string, id: string | null): Promise<AuditSnapshot | null> {
    const loader = this.loaders[entityType];
    if (!loader || !z.uuid().safeParse(id).success || id === null) {
      return null;
    }
    return loader(id);
  }
}
