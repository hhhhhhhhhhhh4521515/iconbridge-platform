import { HttpStatus, Injectable } from '@nestjs/common';
import {
  PARTNER_VISA_STATUSES,
  PARTNER_WORK_PERMIT_STATUSES,
  partnerApplicationIssues,
  partnerLocaleSchema,
  type CreatePartnerApplicationInput,
  type CreatePartnerCommentInput,
  type CreatePartnerJobInput,
  type ListPartnerApplicationsQuery,
  type ListPartnerHistoryQuery,
  type ListPartnerJobsQuery,
  type PartnerApplication,
  type PartnerComment,
  type PartnerHistoryEntry,
  type PartnerJob,
  type PartnerFileKind,
  type PartnerSpaceSummary,
  type PartnerVisaStatus,
  type PartnerWorkPermitStatus,
  type Paginated,
  type UpdatePartnerApplicationInput,
  type UpdatePartnerJobInput,
} from '@iconbridge/shared';
import { AuditService } from '../admin/audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Clock } from '../common/clock/clock.js';
import { AppException, notFound } from '../common/errors/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PARTNER_FILE_SELECT,
  PartnerFilesService,
  toPartnerFile,
} from './partner-files.service.js';
import {
  actorOf,
  changedFields,
  PartnerHistoryService,
  type PartnerActor,
} from './partner-history.service.js';

const jobNotFound = () => notFound('Job demand not found');
const applicationNotFound = () => notFound('Application not found');

/** YYYY-MM-DD of a `date` column, or null. */
const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;
/** A YYYY-MM-DD from the API, as stored in a `date` column. */
const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);

const nameOf = (user: { email: string; displayName: string | null } | null): string | null =>
  user ? (user.displayName ?? user.email) : null;

const PERSON = { select: { email: true, displayName: true } } as const;

const JOB_SELECT = {
  id: true,
  role: true,
  positions: true,
  locations: true,
  salary: true,
  description: true,
  status: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: PERSON,
} satisfies Prisma.PartnerJobSelect;

type JobRow = Prisma.PartnerJobGetPayload<{ select: typeof JOB_SELECT }>;

const APPLICATION_SELECT = {
  id: true,
  partnerJobId: true,
  firstName: true,
  lastName: true,
  nationality: true,
  phone: true,
  email: true,
  workPermitStatus: true,
  workPermitSubmittedDate: true,
  workPermitDecisionDate: true,
  visaStatus: true,
  visaAppointmentDate: true,
  visaDecisionDate: true,
  dhlSentDate: true,
  dhlTrackingNumber: true,
  documentsReceivedDate: true,
  createdAt: true,
  updatedAt: true,
  job: { select: { role: true } },
  files: { select: PARTNER_FILE_SELECT },
  createdBy: PERSON,
  updatedBy: PERSON,
} satisfies Prisma.PartnerApplicationSelect;

type ApplicationRow = Prisma.PartnerApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

/** The editable fields of an application, in the shape of the API. */
function applicationFields(row: ApplicationRow) {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    nationality: row.nationality,
    phone: row.phone,
    email: row.email,
    workPermitStatus: row.workPermitStatus,
    workPermitSubmittedDate: day(row.workPermitSubmittedDate),
    workPermitDecisionDate: day(row.workPermitDecisionDate),
    visaStatus: row.visaStatus,
    visaAppointmentDate: day(row.visaAppointmentDate),
    visaDecisionDate: day(row.visaDecisionDate),
    dhlSentDate: day(row.dhlSentDate),
    dhlTrackingNumber: row.dhlTrackingNumber,
    documentsReceivedDate: day(row.documentsReceivedDate),
  };
}

function toApplication(row: ApplicationRow): PartnerApplication {
  const fileOf = (kind: PartnerFileKind) => {
    const file = row.files.find((item) => item.kind === kind);
    return file ? toPartnerFile(file) : null;
  };
  return {
    id: row.id,
    jobId: row.partnerJobId,
    jobRole: row.job.role,
    ...applicationFields(row),
    files: {
      PASSPORT: fileOf('PASSPORT'),
      CV: fileOf('CV'),
      WORK_PERMIT: fileOf('WORK_PERMIT'),
    },
    createdBy: nameOf(row.createdBy),
    updatedBy: nameOf(row.updatedBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function emptyWorkPermitCounts(): Record<PartnerWorkPermitStatus, number> {
  return Object.fromEntries(PARTNER_WORK_PERMIT_STATUSES.map((status) => [status, 0])) as Record<
    PartnerWorkPermitStatus,
    number
  >;
}

function emptyVisaCounts(): Record<PartnerVisaStatus, number> {
  return Object.fromEntries(PARTNER_VISA_STATUSES.map((status) => [status, 0])) as Record<
    PartnerVisaStatus,
    number
  >;
}

/**
 * The partner area (ADR-027). Every method takes the space found by PartnerSpaceGuard and
 * puts it in the WHERE of every query, read and write: an id of another space is never found.
 * Every change writes the space's history in its transaction.
 */
@Injectable()
export class PartnerAreaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: PartnerHistoryService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly files: PartnerFilesService,
  ) {}

  /** The caller's active spaces; a partner login has one, staff may have several. */
  async mySpaces(user: AuthUser): Promise<PartnerSpaceSummary[]> {
    const rows = await this.prisma.partnerSpaceMember.findMany({
      where: {
        userId: user.id,
        kind: user.role === 'PARTNER' ? 'PARTNER' : 'STAFF',
        space: { isActive: true },
      },
      select: {
        kind: true,
        space: {
          select: { id: true, name: true, country: true, defaultLocale: true, logoPath: true },
        },
      },
      orderBy: { space: { name: 'asc' } },
    });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.space.id,
        name: row.space.name,
        country: row.space.country,
        defaultLocale: partnerLocaleSchema.parse(row.space.defaultLocale),
        hasLogo: row.space.logoPath !== null,
        // Members only: this method lists the caller's own spaces.
        logoUrl: await this.files.logoUrl(row.space.logoPath),
        membership: row.kind,
      })),
    );
  }

  async space(spaceId: string, user: AuthUser): Promise<PartnerSpaceSummary> {
    const space = (await this.mySpaces(user)).find((item) => item.id === spaceId);
    if (!space) {
      throw notFound('Partner space not found');
    }
    return space;
  }

  // -------------------------------------------------------------------------
  // Job demands
  // -------------------------------------------------------------------------

  async listJobs(spaceId: string, query: ListPartnerJobsQuery): Promise<PartnerJob[]> {
    const rows = await this.prisma.partnerJob.findMany({
      where: { partnerSpaceId: spaceId, ...(query.status ? { status: query.status } : {}) },
      select: JOB_SELECT,
      // Open demands first, the newest first.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });
    return this.withCounts(spaceId, rows);
  }

  async getJob(spaceId: string, jobId: string): Promise<PartnerJob> {
    const row = await this.prisma.partnerJob.findFirst({
      where: { id: jobId, partnerSpaceId: spaceId },
      select: JOB_SELECT,
    });
    if (!row) {
      throw jobNotFound();
    }
    const [job] = await this.withCounts(spaceId, [row]);
    return job as PartnerJob;
  }

  async createJob(
    spaceId: string,
    input: CreatePartnerJobInput,
    user: AuthUser,
  ): Promise<PartnerJob> {
    const actor = this.actorFor(user);
    const id = await this.prisma.$transaction(async (tx) => {
      const job = await tx.partnerJob.create({
        data: { ...input, partnerSpaceId: spaceId, createdById: user.id, updatedById: user.id },
        select: { id: true },
      });
      await this.history.record(tx, {
        spaceId,
        actor,
        entityType: 'job',
        entityId: job.id,
        action: 'JOB_CREATED',
        changes: [
          { field: 'role', oldValue: null, newValue: input.role },
          { field: 'positions', oldValue: null, newValue: input.positions },
          { field: 'locations', oldValue: null, newValue: input.locations },
          ...(input.salary ? [{ field: 'salary', oldValue: null, newValue: input.salary }] : []),
        ],
      });
      return job.id;
    });
    return this.getJob(spaceId, id);
  }

  async updateJob(
    spaceId: string,
    jobId: string,
    input: UpdatePartnerJobInput,
    user: AuthUser,
  ): Promise<PartnerJob> {
    const actor = this.actorFor(user);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.partnerJob.findFirst({
        where: { id: jobId, partnerSpaceId: spaceId },
        select: { role: true, positions: true, locations: true, salary: true, description: true },
      });
      if (!before) {
        throw jobNotFound();
      }
      const changes = changedFields(before, input);
      if (changes.length === 0) {
        return;
      }
      await this.updateJobRow(tx, spaceId, jobId, { ...input, updatedById: user.id });
      await this.history.record(tx, {
        spaceId,
        actor,
        entityType: 'job',
        entityId: jobId,
        action: 'JOB_UPDATED',
        // The description is long: the entry says it changed, without the texts.
        changes: changes.map((change) =>
          change.field === 'description' ? { ...change, oldValue: null, newValue: null } : change,
        ),
      });
    });
    return this.getJob(spaceId, jobId);
  }

  /** Closing and reopening: idempotent, and recorded only when the status changes. */
  async setJobStatus(
    spaceId: string,
    jobId: string,
    status: 'OPEN' | 'CLOSED',
    user: AuthUser,
  ): Promise<PartnerJob> {
    const actor = this.actorFor(user);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.partnerJob.findFirst({
        where: { id: jobId, partnerSpaceId: spaceId },
        select: { status: true },
      });
      if (!before) {
        throw jobNotFound();
      }
      if (before.status === status) {
        return;
      }
      await this.updateJobRow(tx, spaceId, jobId, {
        status,
        closedAt: status === 'CLOSED' ? this.clock.now() : null,
        updatedById: user.id,
      });
      await this.history.record(tx, {
        spaceId,
        actor,
        entityType: 'job',
        entityId: jobId,
        action: status === 'CLOSED' ? 'JOB_CLOSED' : 'JOB_REOPENED',
        changes: [{ field: 'status', oldValue: before.status, newValue: status }],
      });
    });
    return this.getJob(spaceId, jobId);
  }

  // -------------------------------------------------------------------------
  // Applications
  // -------------------------------------------------------------------------

  async listApplications(
    spaceId: string,
    query: ListPartnerApplicationsQuery,
  ): Promise<PartnerApplication[]> {
    const rows = await this.prisma.partnerApplication.findMany({
      where: {
        partnerSpaceId: spaceId,
        ...(query.jobId ? { partnerJobId: query.jobId } : {}),
        ...(query.visaStatus ? { visaStatus: query.visaStatus } : {}),
        ...(query.workPermitStatus ? { workPermitStatus: query.workPermitStatus } : {}),
        ...(query.q
          ? {
              OR: [
                { firstName: { contains: query.q, mode: 'insensitive' } },
                { lastName: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: APPLICATION_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.map(toApplication);
  }

  async getApplication(spaceId: string, applicationId: string): Promise<PartnerApplication> {
    return toApplication(await this.applicationRow(this.prisma, spaceId, applicationId));
  }

  async createApplication(
    spaceId: string,
    input: CreatePartnerApplicationInput,
    user: AuthUser,
  ): Promise<PartnerApplication> {
    const actor = this.actorFor(user);
    const { jobId, ...fields } = input;
    const id = await this.prisma.$transaction(async (tx) => {
      const job = await tx.partnerJob.count({ where: { id: jobId, partnerSpaceId: spaceId } });
      if (job === 0) {
        throw jobNotFound();
      }
      const created = await tx.partnerApplication.create({
        data: {
          partnerSpaceId: spaceId,
          partnerJobId: jobId,
          ...fields,
          ...this.dates(fields),
          createdById: user.id,
          updatedById: user.id,
        },
        select: APPLICATION_SELECT,
      });
      await this.history.record(tx, {
        spaceId,
        actor,
        entityType: 'application',
        entityId: created.id,
        applicationId: created.id,
        action: 'APPLICATION_CREATED',
        changes: Object.entries(applicationFields(created))
          .filter(([, value]) => value !== null)
          .map(([field, value]) => ({ field, oldValue: null, newValue: value })),
      });
      return created.id;
    });
    return this.getApplication(spaceId, id);
  }

  async updateApplication(
    spaceId: string,
    applicationId: string,
    input: UpdatePartnerApplicationInput,
    user: AuthUser,
  ): Promise<PartnerApplication> {
    const actor = this.actorFor(user);
    await this.prisma.$transaction(async (tx) => {
      const before = applicationFields(await this.applicationRow(tx, spaceId, applicationId));
      const issues = partnerApplicationIssues({ ...before, ...input });
      if (issues.length > 0) {
        throw new AppException(
          'VALIDATION_ERROR',
          HttpStatus.BAD_REQUEST,
          issues.map((issue) => issue.message).join('; '),
        );
      }
      const changes = changedFields(before, input);
      if (changes.length === 0) {
        return;
      }
      const updated = await tx.partnerApplication.updateMany({
        where: { id: applicationId, partnerSpaceId: spaceId },
        data: { ...input, ...this.dates(input), updatedById: user.id },
      });
      if (updated.count !== 1) {
        throw applicationNotFound();
      }
      await this.history.record(tx, {
        spaceId,
        actor,
        entityType: 'application',
        entityId: applicationId,
        applicationId,
        action: 'APPLICATION_UPDATED',
        changes,
      });
    });
    return this.getApplication(spaceId, applicationId);
  }

  /**
   * Deletes one application with its files, comments and history (ADR-027, rule 11): a super
   * admin who is a member, after typing the applicant's name. One history entry without
   * personal data remains; the audit entry holds counts.
   */
  async deleteApplication(
    spaceId: string,
    applicationId: string,
    confirmName: string,
    user: AuthUser,
    ip: string | null,
  ): Promise<void> {
    if (user.role !== 'SUPER_ADMIN') {
      // Members cannot delete (ADR-027, answer 4): the same answer as an unknown application.
      throw applicationNotFound();
    }
    const actor = this.actorFor(user);
    const row = await this.prisma.partnerApplication.findFirst({
      where: { id: applicationId, partnerSpaceId: spaceId },
      select: {
        firstName: true,
        lastName: true,
        files: { select: { storagePath: true } },
      },
    });
    if (!row) {
      throw applicationNotFound();
    }
    if (confirmName.trim() !== `${row.firstName} ${row.lastName}`) {
      throw new AppException(
        'CONFIRMATION_MISMATCH',
        HttpStatus.BAD_REQUEST,
        "Type the applicant's first and last name exactly to delete the application",
      );
    }
    // The blobs first: if one cannot be deleted, no row is (a retry finishes the job).
    const deletedPaths = row.files.map((file) => file.storagePath);
    await this.files.deleteBlobs(deletedPaths);
    const raced = await this.prisma.$transaction(async (tx) => {
      const current = await tx.partnerApplication.findFirst({
        where: { id: applicationId, partnerSpaceId: spaceId },
        select: {
          files: { select: { storagePath: true } },
          _count: { select: { files: true, comments: true, history: true } },
        },
      });
      if (!current) {
        throw applicationNotFound();
      }
      // Its files, comments and history rows go with it (composite foreign keys, cascade).
      await tx.partnerApplication.deleteMany({
        where: { id: applicationId, partnerSpaceId: spaceId },
      });
      await this.history.record(tx, {
        spaceId,
        actor,
        entityType: 'application',
        entityId: applicationId,
        action: 'APPLICATION_DELETED',
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'partner_application.delete',
          entityType: 'partner_application',
          entityId: applicationId,
          before: {
            partnerSpaceId: spaceId,
            files: current._count.files,
            comments: current._count.comments,
            historyEntries: current._count.history,
          },
          after: null,
          ip,
        },
        tx,
      );
      // A file uploaded between the blob deletion and this transaction.
      return current.files
        .map((file) => file.storagePath)
        .filter((path) => !deletedPaths.includes(path));
    });
    await this.files.deleteQuietly(raced, `deleted application ${applicationId}`);
  }

  // -------------------------------------------------------------------------
  // Comments (append-only) and history
  // -------------------------------------------------------------------------

  async listComments(
    spaceId: string,
    target: { jobId: string } | { applicationId: string },
  ): Promise<PartnerComment[]> {
    await this.assertTarget(this.prisma, spaceId, target);
    const rows = await this.prisma.partnerComment.findMany({
      where: {
        partnerSpaceId: spaceId,
        ...('jobId' in target
          ? { partnerJobId: target.jobId }
          : { partnerApplicationId: target.applicationId }),
      },
      select: { id: true, authorName: true, body: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async addComment(
    spaceId: string,
    target: { jobId: string } | { applicationId: string },
    input: CreatePartnerCommentInput,
    user: AuthUser,
  ): Promise<PartnerComment> {
    const actor = this.actorFor(user);
    return this.prisma.$transaction(async (tx) => {
      await this.assertTarget(tx, spaceId, target);
      const comment = await tx.partnerComment.create({
        data: {
          partnerSpaceId: spaceId,
          ...('jobId' in target
            ? { partnerJobId: target.jobId }
            : { partnerApplicationId: target.applicationId }),
          authorId: user.id,
          authorName: actor.name,
          body: input.body,
        },
        select: { id: true, authorName: true, body: true, createdAt: true },
      });
      // The comment is its own record: the entry says who wrote one, where and when.
      await this.history.record(tx, {
        spaceId,
        actor,
        entityType: 'comment',
        entityId: comment.id,
        applicationId: 'applicationId' in target ? target.applicationId : null,
        action: 'jobId' in target ? 'JOB_COMMENTED' : 'APPLICATION_COMMENTED',
      });
      return { ...comment, createdAt: comment.createdAt.toISOString() };
    });
  }

  async listHistory(
    spaceId: string,
    query: ListPartnerHistoryQuery,
  ): Promise<Paginated<PartnerHistoryEntry>> {
    const where: Prisma.PartnerHistoryWhereInput = {
      partnerSpaceId: spaceId,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.applicationId ? { partnerApplicationId: query.applicationId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.partnerHistory.findMany({
        where,
        select: {
          id: true,
          actorName: true,
          entityType: true,
          entityId: true,
          action: true,
          field: true,
          oldValue: true,
          newValue: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.partnerHistory.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        entityType: row.entityType as PartnerHistoryEntry['entityType'],
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  // -------------------------------------------------------------------------

  private actorFor(user: AuthUser): PartnerActor {
    return actorOf(user);
  }

  private async updateJobRow(
    tx: Prisma.TransactionClient,
    spaceId: string,
    jobId: string,
    data: Prisma.PartnerJobUncheckedUpdateManyInput,
  ): Promise<void> {
    const updated = await tx.partnerJob.updateMany({
      where: { id: jobId, partnerSpaceId: spaceId },
      data,
    });
    if (updated.count !== 1) {
      throw jobNotFound();
    }
  }

  private async applicationRow(
    client: Prisma.TransactionClient,
    spaceId: string,
    applicationId: string,
  ): Promise<ApplicationRow> {
    const row = await client.partnerApplication.findFirst({
      where: { id: applicationId, partnerSpaceId: spaceId },
      select: APPLICATION_SELECT,
    });
    if (!row) {
      throw applicationNotFound();
    }
    return row;
  }

  private async assertTarget(
    client: Prisma.TransactionClient,
    spaceId: string,
    target: { jobId: string } | { applicationId: string },
  ): Promise<void> {
    const found =
      'jobId' in target
        ? await client.partnerJob.count({ where: { id: target.jobId, partnerSpaceId: spaceId } })
        : await client.partnerApplication.count({
            where: { id: target.applicationId, partnerSpaceId: spaceId },
          });
    if (found === 0) {
      throw 'jobId' in target ? jobNotFound() : applicationNotFound();
    }
  }

  /** The six dates of an application, as `date` columns (undefined: unchanged). */
  private dates(fields: UpdatePartnerApplicationInput) {
    return {
      workPermitSubmittedDate: toDate(fields.workPermitSubmittedDate),
      workPermitDecisionDate: toDate(fields.workPermitDecisionDate),
      visaAppointmentDate: toDate(fields.visaAppointmentDate),
      visaDecisionDate: toDate(fields.visaDecisionDate),
      dhlSentDate: toDate(fields.dhlSentDate),
      documentsReceivedDate: toDate(fields.documentsReceivedDate),
    };
  }

  private async withCounts(spaceId: string, rows: JobRow[]): Promise<PartnerJob[]> {
    const where = { partnerSpaceId: spaceId, partnerJobId: { in: rows.map((row) => row.id) } };
    const [visaGroups, permitGroups] = await Promise.all([
      this.prisma.partnerApplication.groupBy({
        by: ['partnerJobId', 'visaStatus'],
        where,
        _count: { _all: true },
      }),
      this.prisma.partnerApplication.groupBy({
        by: ['partnerJobId', 'workPermitStatus'],
        where,
        _count: { _all: true },
      }),
    ]);
    return rows.map((row) => {
      const applications = emptyVisaCounts();
      for (const group of visaGroups.filter((item) => item.partnerJobId === row.id)) {
        applications[group.visaStatus] = group._count._all;
      }
      const workPermits = emptyWorkPermitCounts();
      for (const group of permitGroups.filter((item) => item.partnerJobId === row.id)) {
        workPermits[group.workPermitStatus] = group._count._all;
      }
      return {
        id: row.id,
        role: row.role,
        positions: row.positions,
        locations: row.locations,
        salary: row.salary,
        description: row.description,
        status: row.status,
        closedAt: row.closedAt?.toISOString() ?? null,
        applications,
        workPermits,
        createdBy: nameOf(row.createdBy),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
}
