import { Injectable } from '@nestjs/common';
import type { Category, Destination, PublicStats } from '@iconbridge/shared';
import { localized } from '../jobs/job.mapper.js';
import { OPEN_JOB_SQL } from '../jobs/public-jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const STATS_TTL_MS = 10 * 60 * 1000;

/** Public reference data: active destinations and categories, and the home-page counters. */
@Injectable()
export class CatalogService {
  private stats: { value: PublicStats; expiresAt: number } | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async destinations(): Promise<Destination[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.destination.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.$queryRaw<{ id: string; open: number }[]>`
        SELECT j.destination_id AS id, count(*)::int AS open
        FROM jobs j WHERE ${OPEN_JOB_SQL} GROUP BY j.destination_id`,
    ]);
    const open = new Map(counts.map((count) => [count.id, count.open]));
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: localized(row.name),
      icon: row.icon,
      sortOrder: row.sortOrder,
      openJobs: open.get(row.id) ?? 0,
    }));
  }

  async categories(): Promise<Category[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.jobCategory.findMany({ where: { isActive: true }, orderBy: { slug: 'asc' } }),
      this.prisma.$queryRaw<{ id: string; open: number }[]>`
        SELECT j.category_id AS id, count(*)::int AS open
        FROM jobs j WHERE ${OPEN_JOB_SQL} GROUP BY j.category_id`,
    ]);
    const open = new Map(counts.map((count) => [count.id, count.open]));
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: localized(row.name),
      icon: row.icon,
      openJobs: open.get(row.id) ?? 0,
    }));
  }

  /**
   * Counters of the home page, kept in memory for 10 minutes per API instance:
   * they are shown on every visit and do not need to be exact to the minute.
   */
  async publicStats(now: number = Date.now()): Promise<PublicStats> {
    if (this.stats && this.stats.expiresAt > now) {
      return this.stats.value;
    }
    const [row] = await this.prisma.$queryRaw<PublicStats[]>`
      SELECT
        (SELECT count(*)::int FROM jobs j WHERE ${OPEN_JOB_SQL}) AS "openJobs",
        (SELECT count(*)::int FROM users u
          WHERE u.role = 'CANDIDATE' AND u.deleted_at IS NULL AND u.is_active) AS "registeredCandidates",
        (SELECT count(*)::int FROM applications a
          WHERE a.status IN ('VISA_APPROVED', 'DEPLOYED')) AS "visasApproved",
        (SELECT count(*)::int FROM destinations d WHERE d.is_active) AS "countries"`;
    const value = row ?? { openJobs: 0, registeredCandidates: 0, visasApproved: 0, countries: 0 };
    this.stats = { value, expiresAt: now + STATS_TTL_MS };
    return value;
  }

  /** For tests. */
  clearStatsCache(): void {
    this.stats = undefined;
  }
}
