import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  paginationQuerySchema,
  PERMISSIONS,
  type Paginated,
  type PaginationQuery,
} from '@iconbridge/shared';
import { Roles } from '../../auth/decorators/index.js';
import { ZodQuery } from '../../common/pipes/zod-validation.pipe.js';
import { ApiErrors } from '../../common/swagger/zod-openapi.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

@ApiTags('admin: audit log')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_SETTINGS)
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Audit log, newest first (super admin)' })
  @ApiErrors(401, 403)
  async list(
    @ZodQuery(paginationQuerySchema) query: PaginationQuery,
  ): Promise<Paginated<AuditLogEntry>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { email: true } } },
      }),
      this.prisma.auditLog.count(),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorEmail: row.actor?.email ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before,
        after: row.after,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
