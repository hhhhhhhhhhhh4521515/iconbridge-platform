import { Injectable } from '@nestjs/common';
import type { Category, Destination, PublicStats } from '@iconbridge/shared';
import { localized } from '../jobs/job.mapper.js';
import { OPEN_JOB_SQL } from '../jobs/public-jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ResultsService } from './results.service.js';

export const STATS_TTL_MS = 10 * 60 * 1000;

/** Public reference data: active destinations and categories, and the home-page counters. */
@Injectable()
export class CatalogService {
  private stats: { value: PublicStats; expiresAt: number } | undefined;
  /**
   * Incremented by each clear. A computation that started before a clear read the old
   * figures: it answers its caller but does not keep its result.
   */
  private statsGeneration = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly results: ResultsService,
  ) {}

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
    const generation = this.statsGeneration;
    const [[open], platform, history] = await Promise.all([
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM jobs j WHERE ${OPEN_JOB_SQL}`,
      this.results.platform(),
      this.results.history(),
    ]);
    // The site shows what the agency achieved in all: on this platform and before it.
    const value: PublicStats = {
      openJobs: open?.count ?? 0,
      registeredCandidates: platform.registeredCandidates + history.registeredCandidates,
      visasApproved: platform.visasApproved + history.visasApproved,
      partnerCompanies: platform.partnerCompanies + history.partnerCompanies,
      // Not a sum: the historical figure is the total number of countries served.
      countries: Math.max(platform.countries, history.countries),
    };
    if (generation === this.statsGeneration) {
      this.stats = { value, expiresAt: now + STATS_TTL_MS };
    }
    return value;
  }

  /** Called when a historical figure changes, and by tests: the next read computes the counters again. */
  clearStatsCache(): void {
    this.statsGeneration += 1;
    this.stats = undefined;
  }
}
