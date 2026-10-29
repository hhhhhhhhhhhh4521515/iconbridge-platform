import { Injectable } from '@nestjs/common';
import type { ResultFigures } from '@iconbridge/shared';
import { Prisma } from '../generated/prisma/client.js';
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
/** Figures that are all zero: the history of a dashboard limited to some nationalities. */
export function emptyResults(): ResultFigures {
  return {
    visasApproved: 0,
    visasApprovedThisYear: 0,
    candidatesDeployed: 0,
    registeredCandidates: 0,
    partnerCompanies: 0,
    countries: 0,
    visasByYear: [],
    visasByDestination: [],
  };
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * `countries`: only the applications and accounts of candidates of these nationalities
   * (a country agent's dashboard, ADR-024). Partner companies and countries served stay
   * those of the whole platform: they are not about candidates.
   */
  async platform(countries: string[] | null = null): Promise<ResultFigures> {
    const year = this.clock.now().getUTCFullYear();
    const ofApplication = countries
      ? Prisma.sql`AND a.candidate_id IN (SELECT id FROM candidate_profiles WHERE nationality = ANY(${countries}::text[]))`
      : Prisma.empty;
    const ofUser = countries
      ? Prisma.sql`AND u.id IN (SELECT user_id FROM candidate_profiles WHERE nationality = ANY(${countries}::text[]))`
      : Prisma.empty;
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
          (SELECT count(*)::int FROM applications a
            WHERE a.status IN ('VISA_APPROVED', 'DEPLOYED') ${ofApplication}) AS visas,
          (SELECT count(*)::int FROM applications a WHERE a.status = 'DEPLOYED' ${ofApplication}) AS deployed,
          (SELECT count(*)::int FROM users u
            WHERE u.role = 'CANDIDATE' AND u.deleted_at IS NULL AND u.is_active ${ofUser}) AS candidates,
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
        WHERE a.status IN ('VISA_APPROVED', 'DEPLOYED') ${ofApplication}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ code: string; count: number }[]>`
        SELECT d.code, count(a.id)::int AS count
        FROM destinations d
        LEFT JOIN jobs j ON j.destination_id = d.id
        LEFT JOIN applications a
          ON a.job_id = j.id AND a.status IN ('VISA_APPROVED', 'DEPLOYED') ${ofApplication}
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
