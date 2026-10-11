import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  auditLogEntrySchema,
  auditLogQuerySchema,
  PERMISSIONS,
  type AuditLogEntry,
  type AuditLogQuery,
  type Paginated,
} from '@iconbridge/shared';
import { z } from 'zod';
import { Roles } from '../../auth/decorators/index.js';
import { ZodQuery } from '../../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodResponse } from '../../common/swagger/zod-openapi.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const pageSchema = z.object({
  items: z.array(auditLogEntrySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

@ApiTags('admin: audit log')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_SETTINGS)
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Audit log, newest first, with filters (super admin)' })
  @ApiQuery({ name: 'action', required: false, description: 'Part of the action name' })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'actor', required: false, description: 'Part of the email of who acted' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiZodResponse(200, pageSchema)
  @ApiErrors(400, 401, 403)
  async list(
    @ZodQuery(auditLogQuerySchema) query: AuditLogQuery,
  ): Promise<Paginated<AuditLogEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actor ? { actor: { email: { contains: query.actor.toLowerCase() } } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
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
