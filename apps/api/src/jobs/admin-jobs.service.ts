import { HttpStatus, Injectable } from '@nestjs/common';
import {
  canTransitionJob,
  JOB_TRANSITIONS,
  jobSalarySchema,
  jobSlugBase,
  parseJobQuestions,
  SLUG_MAX_LENGTH,
  type AdminJob,
  type AdminJobListQuery,
  type CreateJobInput,
  type JobAction,
  type Paginated,
  type UpdateJobInput,
  type ValidationIssue,
} from '@iconbridge/shared';
import { AppException, notFound } from '../common/errors/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { JobCoverService } from './job-cover.service.js';
import { cleanRichText } from './rich-text.js';
import { ADMIN_JOB_INCLUDE, localized, toAdminJob, type AdminJobRow } from './job.mapper.js';

const invalid = (details: ValidationIssue[]) =>
  new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'The request is invalid', details);

const isUniqueViolation = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'P2002';

/** The long texts of a job, cleaned of anything but simple formatting. */
function cleanTexts(input: {
  description?: string | undefined;
  requirements?: string | null | undefined;
  benefits?: string | null | undefined;
}) {
  return {
    ...(input.description === undefined ? {} : { description: cleanRichText(input.description) }),
    ...(input.requirements == null ? {} : { requirements: cleanRichText(input.requirements) }),
    ...(input.benefits == null ? {} : { benefits: cleanRichText(input.benefits) }),
  };
}

@Injectable()
export class AdminJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly covers: JobCoverService,
  ) {}

  private readonly mediaUrl = (path: string | null) => this.storage.publicUrl(path);

  async list(query: AdminJobListQuery): Promise<Paginated<AdminJob>> {
    const where: Prisma.JobWhereInput = {
      deletedAt: query.deleted ? { not: null } : null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.destinationId ? { destinationId: query.destinationId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where,
        include: ADMIN_JOB_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.job.count({ where }),
    ]);
    return {
      items: rows.map((row) => toAdminJob(row, this.mediaUrl)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Includes soft-deleted jobs, so their history stays readable. */
  async get(id: string): Promise<AdminJob> {
    const job = await this.prisma.job.findUnique({ where: { id }, include: ADMIN_JOB_INCLUDE });
    if (!job) {
      throw notFound('Job not found');
    }
    return toAdminJob(job, this.mediaUrl);
  }

  /** A new job is a DRAFT: nothing is public until it is published. */
  async create(input: CreateJobInput, actorId: string): Promise<AdminJob> {
    const destination = await this.requireCatalog(input.destinationId, input.categoryId);
    const job = await this.insertWithSlug(input.title, destination.name, (slug) => ({
      ...input,
      ...cleanTexts(input),
      slug,
      deadline: new Date(input.deadline),
      createdById: actorId,
    }));
    return toAdminJob(job, this.mediaUrl);
  }

  async update(id: string, input: UpdateJobInput): Promise<AdminJob> {
    const current = await this.live(id);
    const merged = {
      salaryMin:
        input.salaryMin === undefined ? (current.salaryMin?.toNumber() ?? null) : input.salaryMin,
      salaryMax:
        input.salaryMax === undefined ? (current.salaryMax?.toNumber() ?? null) : input.salaryMax,
      salaryCurrency:
        input.salaryCurrency === undefined ? current.salaryCurrency : input.salaryCurrency,
      salaryPeriod: input.salaryPeriod === undefined ? current.salaryPeriod : input.salaryPeriod,
    };
    const issues: ValidationIssue[] = [];
    const salary = jobSalarySchema.safeParse(merged);
    if (!salary.success) {
      issues.push(
        ...salary.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    const positions = input.positions ?? current.positions;
    if (positions < current.hiredCount) {
      issues.push({
        path: 'positions',
        message: `Cannot be below the ${current.hiredCount} candidates already hired`,
      });
    }
    const deadline = input.deadline ? new Date(input.deadline) : current.deadline;
    if (current.status === 'PUBLISHED' && input.deadline && deadline <= new Date()) {
      issues.push({ path: 'deadline', message: 'A published job needs a deadline in the future' });
    }
    if (issues.length > 0) {
      throw invalid(issues);
    }

    const destinationId = input.destinationId ?? current.destinationId;
    const categoryId = input.categoryId ?? current.categoryId;
    const destination =
      input.destinationId || input.categoryId
        ? await this.requireCatalog(destinationId, categoryId, current)
        : { name: localized(current.destination.name).en };

    // The slug follows the title only while the job was never public: published URLs stay stable.
    const neverPublished = current.status === 'DRAFT' && current.publishedAt === null;
    const renamed = input.title !== undefined && input.title !== current.title;
    const moved = destinationId !== current.destinationId;
    const data = { ...input, ...cleanTexts(input), deadline };

    if (neverPublished && (renamed || moved)) {
      const job = await this.writeWithSlug(
        input.title ?? current.title,
        destination.name,
        id,
        (slug) =>
          this.prisma.job.update({
            where: { id },
            data: { ...data, slug },
            include: ADMIN_JOB_INCLUDE,
          }),
      );
      return toAdminJob(job, this.mediaUrl);
    }
    const job = await this.prisma.job.update({ where: { id }, data, include: ADMIN_JOB_INCLUDE });
    return toAdminJob(job, this.mediaUrl);
  }

  /** publish, close, reopen, archive: checked against JOB_TRANSITIONS in packages/shared. */
  async transition(id: string, action: JobAction): Promise<AdminJob> {
    const current = await this.live(id);
    if (!canTransitionJob(action, current.status)) {
      throw new AppException(
        'INVALID_JOB_TRANSITION',
        HttpStatus.CONFLICT,
        `A job with status ${current.status} cannot be ${ACTION_PAST[action]}`,
        { status: current.status, action, allowedFrom: JOB_TRANSITIONS[action].from },
      );
    }
    const now = new Date();
    if (action === 'publish' || action === 'reopen') {
      this.assertPublishable(current, now);
    }
    const job = await this.prisma.job.update({
      where: { id },
      data: {
        status: JOB_TRANSITIONS[action].to,
        ...(action === 'publish' ? { publishedAt: current.publishedAt ?? now } : {}),
        ...(action === 'close' ? { closedAt: now } : {}),
        ...(action === 'reopen' ? { closedAt: null } : {}),
        ...(action === 'archive' ? { closedAt: current.closedAt ?? now, featured: false } : {}),
      },
      include: ADMIN_JOB_INCLUDE,
    });
    return toAdminJob(job, this.mediaUrl);
  }

  async setFeatured(id: string, featured: boolean): Promise<AdminJob> {
    await this.live(id);
    const job = await this.prisma.job.update({
      where: { id },
      data: { featured },
      include: ADMIN_JOB_INCLUDE,
    });
    return toAdminJob(job, this.mediaUrl);
  }

  /** Copies the offer into a new DRAFT: no applications, no hires, no cover, not featured. */
  async duplicate(id: string, actorId: string): Promise<AdminJob> {
    const source = await this.live(id);
    const title = `${source.title} (copy)`.slice(0, 150);
    const job = await this.insertWithSlug(title, localized(source.destination.name).en, (slug) => ({
      title,
      slug,
      destinationId: source.destinationId,
      categoryId: source.categoryId,
      employerName: source.employerName,
      showEmployerName: source.showEmployerName,
      description: source.description,
      requirements: source.requirements,
      benefits: source.benefits,
      accommodationProvided: source.accommodationProvided,
      transportProvided: source.transportProvided,
      mealsProvided: source.mealsProvided,
      salaryMin: source.salaryMin,
      salaryMax: source.salaryMax,
      salaryCurrency: source.salaryCurrency,
      salaryPeriod: source.salaryPeriod,
      contractDurationMonths: source.contractDurationMonths,
      workingHours: source.workingHours,
      positions: source.positions,
      requiredLanguages: source.requiredLanguages,
      questions: parseJobQuestions(source.questions),
      deadline: source.deadline,
      createdById: actorId,
    }));
    return toAdminJob(job, this.mediaUrl);
  }

  /**
   * Soft delete by default: the row stays for history and existing applications.
   * `permanent` really deletes, and is refused as soon as one application exists.
   */
  async remove(id: string, permanent: boolean): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id },
      select: {
        id: true,
        deletedAt: true,
        coverImagePath: true,
        _count: { select: { applications: true } },
      },
    });
    if (!job) {
      throw notFound('Job not found');
    }
    if (!permanent) {
      if (!job.deletedAt) {
        await this.prisma.job.update({
          where: { id },
          data: { deletedAt: new Date(), featured: false },
        });
      }
      return;
    }
    if (job._count.applications > 0) {
      throw new AppException(
        'JOB_HAS_APPLICATIONS',
        HttpStatus.CONFLICT,
        'A job that received applications cannot be deleted permanently',
        { applications: job._count.applications },
      );
    }
    try {
      await this.prisma.job.delete({ where: { id } });
    } catch (error) {
      // An application arrived between the check and the delete: the foreign key refuses.
      if (error instanceof Error && 'code' in error && error.code === 'P2003') {
        throw new AppException(
          'JOB_HAS_APPLICATIONS',
          HttpStatus.CONFLICT,
          'A job that received applications cannot be deleted permanently',
        );
      }
      throw error;
    }
    if (job.coverImagePath) {
      await this.storage.deletePublic(job.coverImagePath);
    }
  }

  async setCover(id: string, file: Buffer): Promise<AdminJob> {
    const current = await this.live(id);
    const cover = await this.covers.process(file);
    const path = `jobs/${id}/${cover.fileName}`;
    await this.storage.uploadPublic(path, cover.content, cover.contentType);
    const job = await this.prisma.job.update({
      where: { id },
      data: { coverImagePath: path },
      include: ADMIN_JOB_INCLUDE,
    });
    if (current.coverImagePath && current.coverImagePath !== path) {
      await this.storage.deletePublic(current.coverImagePath);
    }
    return toAdminJob(job, this.mediaUrl);
  }

  async removeCover(id: string): Promise<AdminJob> {
    const current = await this.live(id);
    const job = await this.prisma.job.update({
      where: { id },
      data: { coverImagePath: null },
      include: ADMIN_JOB_INCLUDE,
    });
    if (current.coverImagePath) {
      await this.storage.deletePublic(current.coverImagePath);
    }
    return toAdminJob(job, this.mediaUrl);
  }

  /** The job, unless it is missing or soft-deleted: a deleted job cannot be changed. */
  private async live(id: string): Promise<AdminJobRow> {
    const job = await this.prisma.job.findFirst({
      where: { id, deletedAt: null },
      include: ADMIN_JOB_INCLUDE,
    });
    if (!job) {
      throw notFound('Job not found');
    }
    return job;
  }

  private assertPublishable(job: AdminJobRow, now: Date): void {
    const reasons: string[] = [];
    if (job.deadline <= now) reasons.push('The application deadline has passed');
    if (job.hiredCount >= job.positions) reasons.push('Every position is already filled');
    if (!job.destination.isActive) reasons.push('The destination is inactive');
    if (!job.category.isActive) reasons.push('The category is inactive');
    if (reasons.length > 0) {
      throw new AppException(
        'JOB_NOT_PUBLISHABLE',
        HttpStatus.CONFLICT,
        'This job cannot be open to candidates yet',
        { reasons },
      );
    }
  }

  /**
   * Checks that the destination and the category exist and are active. An inactive
   * one is still accepted when the job already uses it (editing an old job).
   */
  private async requireCatalog(
    destinationId: string,
    categoryId: string,
    current?: { destinationId: string; categoryId: string },
  ): Promise<{ name: string }> {
    const [destination, category] = await Promise.all([
      this.prisma.destination.findUnique({ where: { id: destinationId } }),
      this.prisma.jobCategory.findUnique({ where: { id: categoryId } }),
    ]);
    const issues: ValidationIssue[] = [];
    if (!destination || (!destination.isActive && current?.destinationId !== destinationId)) {
      issues.push({ path: 'destinationId', message: 'Unknown or inactive destination' });
    }
    if (!category || (!category.isActive && current?.categoryId !== categoryId)) {
      issues.push({ path: 'categoryId', message: 'Unknown or inactive category' });
    }
    if (!destination || issues.length > 0) {
      throw invalid(issues);
    }
    return { name: localized(destination.name).en };
  }

  private insertWithSlug(
    title: string,
    destinationName: string,
    data: (slug: string) => Prisma.JobUncheckedCreateInput,
  ): Promise<AdminJobRow> {
    return this.writeWithSlug(title, destinationName, null, (slug) =>
      this.prisma.job.create({ data: data(slug), include: ADMIN_JOB_INCLUDE }),
    );
  }

  /**
   * Slug = title + destination ("hotel-receptionist-malta"), then "-2", "-3"... when taken.
   * Deleted jobs keep their slug, so an old URL never points to a different offer.
   * The unique index decides in the end: on a collision with a concurrent write, try the next one.
   */
  private async writeWithSlug(
    title: string,
    destinationName: string,
    ownId: string | null,
    write: (slug: string) => Promise<AdminJobRow>,
  ): Promise<AdminJobRow> {
    const base = jobSlugBase(title, destinationName);
    const taken = new Set(
      (
        await this.prisma.job.findMany({
          where: { slug: { startsWith: base }, ...(ownId ? { id: { not: ownId } } : {}) },
          select: { slug: true },
        })
      ).map((job) => job.slug),
    );
    let suffix = 1;
    for (let attempt = 0; attempt < 5; attempt++) {
      let slug = base;
      while (taken.has(slug)) {
        suffix += 1;
        const ending = `-${suffix}`;
        slug = `${base.slice(0, SLUG_MAX_LENGTH - ending.length)}${ending}`;
      }
      try {
        return await write(slug);
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        taken.add(slug);
      }
    }
    throw new AppException(
      'CONFLICT',
      HttpStatus.CONFLICT,
      'Could not find a free slug, try again',
    );
  }
}

const ACTION_PAST: Record<JobAction, string> = {
  publish: 'published',
  close: 'closed',
  reopen: 'reopened',
  archive: 'archived',
};
