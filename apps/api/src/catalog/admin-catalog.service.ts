import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AdminCategory,
  AdminDestination,
  CreateCategoryInput,
  CreateDestinationInput,
  RemovalResult,
  UpdateCategoryInput,
  UpdateDestinationInput,
} from '@iconbridge/shared';
import { AppException, notFound } from '../common/errors/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { localized } from '../jobs/job.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DESTINATION_INCLUDE = {
  _count: { select: { jobs: true, successStories: true, homeSlides: true } },
} satisfies Prisma.DestinationInclude;
const CATEGORY_INCLUDE = { _count: { select: { jobs: true } } } satisfies Prisma.JobCategoryInclude;

type DestinationRow = Prisma.DestinationGetPayload<{ include: typeof DESTINATION_INCLUDE }>;
type CategoryRow = Prisma.JobCategoryGetPayload<{ include: typeof CATEGORY_INCLUDE }>;

const toDestination = (row: DestinationRow): AdminDestination => ({
  id: row.id,
  code: row.code,
  name: localized(row.name),
  icon: row.icon,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
  jobCount: row._count.jobs,
});

const toCategory = (row: CategoryRow): AdminCategory => ({
  id: row.id,
  slug: row.slug,
  name: localized(row.name),
  icon: row.icon,
  isActive: row.isActive,
  jobCount: row._count.jobs,
});

const taken = (what: string) =>
  new AppException('CONFLICT', HttpStatus.CONFLICT, `This ${what} is already used`);

const isUniqueViolation = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'P2002';

/** Destinations and job categories as the back office manages them (active and inactive). */
@Injectable()
export class AdminCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listDestinations(): Promise<AdminDestination[]> {
    const rows = await this.prisma.destination.findMany({
      include: DESTINATION_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toDestination);
  }

  async createDestination(input: CreateDestinationInput): Promise<AdminDestination> {
    try {
      return toDestination(
        await this.prisma.destination.create({ data: input, include: DESTINATION_INCLUDE }),
      );
    } catch (error) {
      throw isUniqueViolation(error) ? taken('code') : error;
    }
  }

  /** The code is the stable identifier used in URLs and filters: it cannot be changed. */
  async updateDestination(id: string, input: UpdateDestinationInput): Promise<AdminDestination> {
    if (!(await this.prisma.destination.findUnique({ where: { id }, select: { id: true } }))) {
      throw notFound('Destination not found');
    }
    return toDestination(
      await this.prisma.destination.update({
        where: { id },
        data: input,
        include: DESTINATION_INCLUDE,
      }),
    );
  }

  /** Deleted when nothing refers to it; otherwise only deactivated, so history stays intact. */
  async removeDestination(id: string): Promise<RemovalResult> {
    const row = await this.prisma.destination.findUnique({
      where: { id },
      include: DESTINATION_INCLUDE,
    });
    if (!row) {
      throw notFound('Destination not found');
    }
    const used = row._count.jobs + row._count.successStories + row._count.homeSlides > 0;
    if (!used) {
      try {
        await this.prisma.destination.delete({ where: { id } });
        return { outcome: 'deleted' };
      } catch (error) {
        // Something started using it in the meantime (foreign key): fall back to deactivation.
        if (!(error instanceof Error && 'code' in error && error.code === 'P2003')) {
          throw error;
        }
      }
    }
    await this.prisma.destination.update({ where: { id }, data: { isActive: false } });
    return { outcome: 'deactivated' };
  }

  async listCategories(): Promise<AdminCategory[]> {
    const rows = await this.prisma.jobCategory.findMany({
      include: CATEGORY_INCLUDE,
      orderBy: { slug: 'asc' },
    });
    return rows.map(toCategory);
  }

  async createCategory(input: CreateCategoryInput): Promise<AdminCategory> {
    try {
      return toCategory(
        await this.prisma.jobCategory.create({ data: input, include: CATEGORY_INCLUDE }),
      );
    } catch (error) {
      throw isUniqueViolation(error) ? taken('slug') : error;
    }
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<AdminCategory> {
    if (!(await this.prisma.jobCategory.findUnique({ where: { id }, select: { id: true } }))) {
      throw notFound('Category not found');
    }
    return toCategory(
      await this.prisma.jobCategory.update({
        where: { id },
        data: input,
        include: CATEGORY_INCLUDE,
      }),
    );
  }

  async removeCategory(id: string): Promise<RemovalResult> {
    const row = await this.prisma.jobCategory.findUnique({
      where: { id },
      include: CATEGORY_INCLUDE,
    });
    if (!row) {
      throw notFound('Category not found');
    }
    if (row._count.jobs === 0) {
      try {
        await this.prisma.jobCategory.delete({ where: { id } });
        return { outcome: 'deleted' };
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'P2003')) {
          throw error;
        }
      }
    }
    await this.prisma.jobCategory.update({ where: { id }, data: { isActive: false } });
    return { outcome: 'deactivated' };
  }
}
