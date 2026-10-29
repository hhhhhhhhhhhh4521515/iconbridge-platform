import { Injectable } from '@nestjs/common';
import { APPLICATION_STATUSES, type AdminStats, type ApplicationStatus } from '@iconbridge/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { Clock } from '../common/clock/clock.js';
import { scopedNationalities } from '../common/scope/candidate-scope.js';
import { Prisma } from '../generated/prisma/client.js';
import { OPEN_JOB_SQL } from '../jobs/public-jobs.service.js';
import { emptyResults, ResultsService } from '../catalog/results.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * `AND a.candidate_id IN (candidates of these nationalities)` for the applications aliased
 * `a`, or nothing when the figures cover the whole platform. The countries are a bound
 * parameter; the alias is a constant of this file.
 */
export function applicationScopeSql(countries: string[] | null): Prisma.Sql {
  return countries
    ? Prisma.sql`AND a.candidate_id IN (SELECT id FROM candidate_profiles WHERE nationality = ANY(${countries}::text[]))`
    : Prisma.empty;
}

/**
 * Figures of the back-office dashboard. Erased candidates still count: their rows are
 * anonymous. A country agent gets the figures of his nationalities only, without the
 * historical figures, which are not recorded by nationality (ADR-024).
 */
@Injectable()
export class AdminStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly results: ResultsService,
  ) {}

  async get(viewer: Pick<AuthUser, 'role' | 'assignedCountries'>): Promise<AdminStats> {
    const countries = scopedNationalities(viewer);
    const scope = applicationScopeSql(countries);
    const now = this.clock.now();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    // Monday 00:00 UTC of the current week.
    const weekStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
      ),
    );
    // First day of the month, 11 months ago: the window is the current month and the 11 before.
    const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

    const [open, byStatus, byDestination, byMonth, visas, average, week] =
      await this.prisma.$transaction([
        this.prisma.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM jobs j WHERE ${OPEN_JOB_SQL}`,
        this.prisma.$queryRaw<{ status: ApplicationStatus; count: number }[]>`
        SELECT a.status::text AS status, count(*)::int AS count
        FROM applications a WHERE TRUE ${scope} GROUP BY a.status`,
        this.prisma.$queryRaw<{ code: string; count: number }[]>`
        SELECT d.code, count(a.id)::int AS count
        FROM destinations d
        LEFT JOIN jobs j ON j.destination_id = d.id
        LEFT JOIN applications a ON a.job_id = j.id ${scope}
        GROUP BY d.code, d.sort_order ORDER BY d.sort_order, d.code`,
        this.prisma.$queryRaw<{ month: string; count: number }[]>`
        SELECT to_char(m.month, 'YYYY-MM') AS month, count(a.id)::int AS count
        FROM generate_series(${windowStart}::timestamptz, ${now}::timestamptz, interval '1 month') AS m(month)
        LEFT JOIN applications a
          ON a.applied_at >= m.month AND a.applied_at < m.month + interval '1 month' ${scope}
        GROUP BY m.month ORDER BY m.month`,
        this.prisma.$queryRaw<{ count: number }[]>`
        SELECT count(DISTINCT h.application_id)::int AS count
        FROM application_status_history h
        JOIN applications a ON a.id = h.application_id
        WHERE h.to_status = 'VISA_APPROVED' AND h.reverted_at IS NULL AND h.created_at >= ${yearStart} ${scope}`,
        this.prisma.$queryRaw<{ days: number | null }[]>`
        SELECT round(avg(extract(epoch FROM (v.approved_at - a.applied_at)) / 86400)::numeric, 1)::float8 AS days
        FROM applications a
        JOIN (
          SELECT application_id, min(created_at) AS approved_at
          FROM application_status_history
          WHERE to_status = 'VISA_APPROVED' AND reverted_at IS NULL GROUP BY application_id
        ) v ON v.application_id = a.id
        WHERE TRUE ${scope}`,
        this.prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM applications a WHERE a.applied_at >= ${weekStart} ${scope}`,
      ]);

    const [platform, history] = await Promise.all([
      this.results.platform(countries),
      countries ? emptyResults() : this.results.history(),
    ]);
    const counts = new Map(byStatus.map((row) => [row.status, row.count]));
    return {
      scopeCountries: countries,
      platform,
      history,
      openJobs: open[0]?.count ?? 0,
      newApplicationsThisWeek: week[0]?.count ?? 0,
      applicationsByStatus: Object.fromEntries(
        APPLICATION_STATUSES.map((status) => [status, counts.get(status) ?? 0]),
      ) as AdminStats['applicationsByStatus'],
      applicationsByDestination: byDestination,
      applicationsByMonth: byMonth,
      visasApprovedThisYear: visas[0]?.count ?? 0,
      averageDaysToVisaApproved: average[0]?.days ?? null,
    };
  }
}
