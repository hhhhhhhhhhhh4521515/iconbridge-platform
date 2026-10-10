import { Injectable } from '@nestjs/common';
import type { JobListQuery, JobSort, Paginated, PublicJob } from '@iconbridge/shared';
import { notFound } from '../common/errors/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { JOB_INCLUDE, toPublicJob } from './job.mapper.js';

/**
 * The only definition of "open to candidates" in SQL (alias `j` = jobs). It does
 * not rely on the scheduled task having run: an expired or full job disappears
 * at once. Mirrors `isJobOpen` in packages/shared.
 */
export const OPEN_JOB_SQL = Prisma.sql`
  j.status = 'PUBLISHED'
  AND j.deleted_at IS NULL
  AND j.deadline > now()
  AND j.hired_count < j.positions`;

const MAX_SEARCH_WORDS = 8;

/**
 * Turns free text into a prefix tsquery: "hotel guest" becomes "hotel:* & guest:*",
 * so every word must be present and "guest" also finds "guests". Only letters and
 * digits are kept, which makes the text safe for to_tsquery. Null when no word is left.
 */
export function prefixTsQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_SEARCH_WORDS);
  return words.length > 0 ? words.map((word) => `${word}:*`).join(' & ') : null;
}

@Injectable()
export class PublicJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(query: JobListQuery): Promise<Paginated<PublicJob>> {
    const where = Prisma.join(this.conditions(query), ' AND ');
    const sort: JobSort = query.sort ?? (query.q ? 'relevance' : 'newest');
    const offset = (query.page - 1) * query.pageSize;

    const [counted, page] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM jobs j WHERE ${where}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT j.id FROM jobs j
        WHERE ${where}
        ORDER BY ${this.orderBy(sort, query.q)}
        LIMIT ${query.pageSize} OFFSET ${offset}`,
    ]);

    const ids = page.map((row) => row.id);
    const rows = await this.prisma.job.findMany({
      where: { id: { in: ids } },
      include: JOB_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const mediaUrl = (path: string | null) => this.storage.publicUrl(path);
    return {
      items: ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toPublicJob(row, mediaUrl)] : [];
      }),
      page: query.page,
      pageSize: query.pageSize,
      total: counted[0]?.total ?? 0,
    };
  }

  /** 404 for a job that is not open, exactly as for a slug that does not exist. */
  async getBySlug(slug: string): Promise<PublicJob> {
    const open = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT j.id FROM jobs j WHERE j.slug = ${slug} AND ${OPEN_JOB_SQL}`;
    const id = open[0]?.id;
    const job = id
      ? await this.prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE })
      : null;
    if (!job) {
      throw notFound('Job not found');
    }
    return toPublicJob(job, (path) => this.storage.publicUrl(path));
  }

  private conditions(query: JobListQuery): Prisma.Sql[] {
    const conditions = [OPEN_JOB_SQL];
    if (query.destination) {
      conditions.push(
        Prisma.sql`j.destination_id IN (SELECT d.id FROM destinations d WHERE d.code = ${query.destination})`,
      );
    }
    if (query.category) {
      conditions.push(
        Prisma.sql`j.category_id IN (SELECT c.id FROM job_categories c WHERE c.slug = ${query.category})`,
      );
    }
    // A salary filter only matches jobs that state a salary; ranges overlap the requested bounds.
    if (query.salaryMin !== undefined) {
      conditions.push(Prisma.sql`coalesce(j.salary_max, j.salary_min) >= ${query.salaryMin}`);
    }
    if (query.salaryMax !== undefined) {
      conditions.push(Prisma.sql`coalesce(j.salary_min, j.salary_max) <= ${query.salaryMax}`);
    }
    if (query.currency) {
      conditions.push(Prisma.sql`j.salary_currency = ${query.currency}`);
    }
    if (query.language) {
      conditions.push(Prisma.sql`j.required_languages @> ARRAY[${query.language}]::text[]`);
    }
    if (query.featured !== undefined) {
      conditions.push(Prisma.sql`j.featured = ${query.featured}`);
    }
    if (query.q) {
      // A title word close to the text (pg_trgm word similarity, default threshold 0.6):
      // "welders" and "reciptionist" find "Welder" and "Receptionist"...
      const fuzzyTitle = Prisma.sql`${query.q} <% j.title`;
      // ...or every word found, as a prefix, in the title or the description.
      const tsQuery = prefixTsQuery(query.q);
      conditions.push(
        tsQuery
          ? Prisma.sql`(j.search_vector @@ to_tsquery('simple'::regconfig, ${tsQuery}) OR ${fuzzyTitle})`
          : fuzzyTitle,
      );
    }
    return conditions;
  }

  private orderBy(sort: JobSort, q: string | undefined): Prisma.Sql {
    switch (sort) {
      case 'relevance': {
        const tsQuery = prefixTsQuery(q ?? '');
        const rank = tsQuery
          ? Prisma.sql`ts_rank(j.search_vector, to_tsquery('simple'::regconfig, ${tsQuery}))`
          : Prisma.sql`0`;
        // Title weight A outranks description weight B; similarity favours the closest title.
        return Prisma.sql`
          ${rank} + word_similarity(${q ?? ''}, j.title) DESC,
          j.published_at DESC NULLS LAST, j.id`;
      }
      case 'deadline':
        return Prisma.sql`j.deadline ASC, j.id`;
      case 'salary':
        // Highest pay first. Amounts are compared as stored: combine with `currency` to compare like with like.
        return Prisma.sql`coalesce(j.salary_max, j.salary_min) DESC NULLS LAST, j.id`;
      case 'newest':
        return Prisma.sql`j.published_at DESC NULLS LAST, j.id`;
    }
  }
}
