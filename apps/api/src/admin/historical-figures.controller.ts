import { Controller, Delete, Get, HttpCode, HttpStatus, Put, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  historicalFigureInputSchema,
  historicalFigureSchema,
  PERMISSIONS,
  uuidParamSchema,
  type HistoricalFigure,
  type HistoricalFigureInput,
} from '@iconbridge/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta, type AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators/index.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AppException, notFound } from '../common/errors/app.exception.js';
import { ZodBody, ZodParams } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SkipAudit } from './audit/audit.decorator.js';
import { AuditService } from './audit/audit.service.js';

const INCLUDE = {
  destination: { select: { code: true } },
} satisfies Prisma.HistoricalFigureInclude;
type Row = Prisma.HistoricalFigureGetPayload<{ include: typeof INCLUDE }>;

const toFigure = (row: Row): HistoricalFigure => ({
  id: row.id,
  metric: row.metric,
  year: row.year,
  destinationId: row.destinationId,
  destinationCode: row.destination?.code ?? null,
  value: row.value,
  note: row.note,
  updatedAt: row.updatedAt.toISOString(),
});

/** What the audit log keeps of a figure: its place and its value. */
const snapshot = (row: Row | null) =>
  row
    ? {
        metric: row.metric,
        year: row.year,
        destination: row.destination?.code ?? null,
        value: row.value,
        note: row.note,
      }
    : null;

/**
 * Results from before the platform, entered by the super admin. They live in their
 * own table and are added to the live figures only when a total is displayed.
 */
@ApiTags('admin: historical results')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_SETTINGS)
@Controller('admin/historical-figures')
export class HistoricalFiguresController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Every historical figure (super admin)' })
  @ApiZodResponse(200, z.array(historicalFigureSchema))
  @ApiErrors(401, 403)
  async list(): Promise<HistoricalFigure[]> {
    const rows = await this.prisma.historicalFigure.findMany({
      include: INCLUDE,
      orderBy: [{ year: 'desc' }, { metric: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toFigure);
  }

  @Put()
  @SkipAudit()
  @ApiOperation({
    summary: 'Set one historical figure (super admin)',
    description:
      'One figure per metric, year and destination: sending it again replaces the value. The two global ' +
      'metrics (PARTNER_COMPANIES, COUNTRIES_SERVED) have neither year nor destination. The change is written ' +
      'to the audit log with the value before and after, and the public counters are computed again.',
  })
  @ApiZodBody(historicalFigureInputSchema)
  @ApiZodResponse(200, historicalFigureSchema)
  @ApiErrors(400, 401, 403)
  async set(
    @ZodBody(historicalFigureInputSchema) body: HistoricalFigureInput,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<HistoricalFigure> {
    if (
      body.destinationId &&
      !(await this.prisma.destination.findUnique({
        where: { id: body.destinationId },
        select: { id: true },
      }))
    ) {
      throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'The request is invalid', [
        { path: 'destinationId', message: 'Unknown destination' },
      ]);
    }
    const where = { metric: body.metric, year: body.year, destinationId: body.destinationId };
    const data = { value: body.value, note: body.note ?? null };
    const saved = await this.prisma.$transaction(async (tx) => {
      // Two super admins saving the same figure are handled one after the other.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('historical_figures', 0))::text AS locked`;
      const before = await tx.historicalFigure.findFirst({ where, include: INCLUDE });
      const row = before
        ? await tx.historicalFigure.update({ where: { id: before.id }, data, include: INCLUDE })
        : await tx.historicalFigure.create({ data: { ...where, ...data }, include: INCLUDE });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'historical_figure.set',
          entityType: 'historicalFigure',
          entityId: row.id,
          before: snapshot(before),
          after: snapshot(row),
          ip: requestMeta(request).ip,
        },
        tx,
      );
      return row;
    });
    this.catalog.clearStatsCache();
    return toFigure(saved);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipAudit()
  @ApiOperation({ summary: 'Remove one historical figure (super admin)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404)
  async remove(
    @ZodParams(uuidParamSchema) params: { id: string },
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.historicalFigure.findUnique({
        where: { id: params.id },
        include: INCLUDE,
      });
      if (!before) {
        throw notFound('Figure not found');
      }
      await tx.historicalFigure.delete({ where: { id: params.id } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'historical_figure.delete',
          entityType: 'historicalFigure',
          entityId: params.id,
          before: snapshot(before),
          after: null,
          ip: requestMeta(request).ip,
        },
        tx,
      );
    });
    this.catalog.clearStatsCache();
  }
}
