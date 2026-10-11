import { Injectable } from '@nestjs/common';
import type { ResultFigures } from '@iconbridge/shared';
import { Clock } from '../common/clock/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The results of the agency, from two sources that are never mixed in the database:
 *
 * - `platform`: computed from the applications, accounts and jobs of this platform;
 * - `history`: figures from before the platform, entered by the super admin in
 *   `historical_figures`.
 *
 * The dashboard shows both with their sum; the public counters show the sum.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async platform(): Promise<ResultFigures> {
    const year = this.clock.now().getUTCFullYear();
    const [totals, byYear, byDestination] = await this.prisma.$transaction([
      this.prisma.$queryRaw<
        {
          visas: number;
          deployed: number;
          candidates: number;
          companies: number;
          countries: number;
        }[]
      >`
        SELECT
          (SELECT count(*)::int FROM applications
            WHERE status IN ('VISA_APPROVED', 'DEPLOYED')) AS visas,
          (SELECT count(*)::int FROM applications WHERE status = 'DEPLOYED') AS deployed,
          (SELECT count(*)::int FROM users u
            WHERE u.role = 'CANDIDATE' AND u.deleted_at IS NULL AND u.is_active) AS candidates,
          (SELECT count(DISTINCT lower(btrim(j.employer_name)))::int FROM jobs j
            WHERE j.published_at IS NOT NULL AND j.deleted_at IS NULL
              AND btrim(coalesce(j.employer_name, '')) <> '') AS companies,
          (SELECT count(*)::int FROM destinations d WHERE d.is_active) AS countries`,
      // A visa counts in the year it was approved; without that date, the year of the application.
      this.prisma.$queryRaw<{ year: number; count: number }[]>`
        SELECT extract(year FROM coalesce(v.approved_at, a.applied_at))::int AS year,
               count(*)::int AS count
        FROM applications a
        LEFT JOIN (
          SELECT application_id, min(created_at) AS approved_at
          FROM application_status_history
          WHERE to_status = 'VISA_APPROVED' AND reverted_at IS NULL
          GROUP BY application_id
        ) v ON v.application_id = a.id
        WHERE a.status IN ('VISA_APPROVED', 'DEPLOYED')
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ code: string; count: number }[]>`
        SELECT d.code, count(a.id)::int AS count
        FROM destinations d
        LEFT JOIN jobs j ON j.destination_id = d.id
        LEFT JOIN applications a
          ON a.job_id = j.id AND a.status IN ('VISA_APPROVED', 'DEPLOYED')
        GROUP BY d.code, d.sort_order ORDER BY d.sort_order, d.code`,
    ]);
    const total = totals[0];
    return {
      visasApproved: total?.visas ?? 0,
      visasApprovedThisYear: byYear.find((row) => row.year === year)?.count ?? 0,
      candidatesDeployed: total?.deployed ?? 0,
      registeredCandidates: total?.candidates ?? 0,
      partnerCompanies: total?.companies ?? 0,
      countries: total?.countries ?? 0,
      visasByYear: byYear,
      visasByDestination: byDestination,
    };
  }

  async history(): Promise<ResultFigures> {
    const year = this.clock.now().getUTCFullYear();
    const rows = await this.prisma.historicalFigure.findMany({
      include: { destination: { select: { code: true, sortOrder: true } } },
    });
    const sum = (metric: string, keep: (row: (typeof rows)[number]) => boolean = () => true) =>
      rows
        .filter((row) => row.metric === metric && keep(row))
        .reduce((total, row) => total + row.value, 0);
    const visas = rows.filter((row) => row.metric === 'VISAS_APPROVED');
    const years = [...new Set(visas.flatMap((row) => row.year ?? []))].sort((a, b) => a - b);
    const destinations = [
      ...new Map(
        visas.flatMap((row) => (row.destination ? [[row.destination.code, row.destination]] : [])),
      ).entries(),
    ].sort(([a, x], [b, y]) => x.sortOrder - y.sortOrder || a.localeCompare(b));
    return {
      visasApproved: sum('VISAS_APPROVED'),
      visasApprovedThisYear: sum('VISAS_APPROVED', (row) => row.year === year),
      candidatesDeployed: sum('CANDIDATES_DEPLOYED'),
      registeredCandidates: sum('CANDIDATES_REGISTERED'),
      partnerCompanies: sum('PARTNER_COMPANIES'),
      countries: sum('COUNTRIES_SERVED'),
      visasByYear: years.map((value) => ({
        year: value,
        count: sum('VISAS_APPROVED', (row) => row.year === value),
      })),
      visasByDestination: destinations.map(([code]) => ({
        code,
        count: sum('VISAS_APPROVED', (row) => row.destination?.code === code),
      })),
    };
  }
}
