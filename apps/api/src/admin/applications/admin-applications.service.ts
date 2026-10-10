import { HttpStatus, Injectable } from '@nestjs/common';
import {
  allowedApplicationTransitions,
  canTransitionApplication,
  localeSchema,
  type AdminApplicationDetail,
  type AdminApplicationListQuery,
  type AdminApplicationSummary,
  type ApplicationFilters,
  type ApplicationStatus,
  type BulkApplicationStatusInput,
  type BulkResult,
  type ChangeApplicationStatusInput,
  type Paginated,
} from '@iconbridge/shared';
import type { AuthUser } from '../../auth/auth.types.js';
import { Clock } from '../../common/clock/clock.js';
import { AppException, forbidden, notFound } from '../../common/errors/app.exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MailService } from '../../mail/mail.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const SUMMARY_INCLUDE = {
  job: { select: { id: true, title: true, slug: true, destination: { select: { code: true } } } },
  candidate: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nationality: true,
      user: { select: { email: true, locale: true } },
    },
  },
} satisfies Prisma.ApplicationInclude;

const DETAIL_INCLUDE = {
  ...SUMMARY_INCLUDE,
  documents: { include: { document: true }, orderBy: { createdAt: 'asc' } },
  statusHistory: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { changedBy: { select: { email: true } } },
  },
  notes: { orderBy: { createdAt: 'asc' }, include: { author: { select: { email: true } } } },
} satisfies Prisma.ApplicationInclude;

type SummaryRow = Prisma.ApplicationGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

/** Turns the filters shared by the list and the export into a Prisma condition. */
export function applicationWhere(filters: ApplicationFilters): Prisma.ApplicationWhereInput {
  const candidate: Prisma.CandidateProfileWhereInput = {
    ...(filters.nationality ? { nationality: filters.nationality } : {}),
    ...(filters.language ? { languages: { some: { language: filters.language } } } : {}),
    ...(filters.q
      ? {
          OR: [
            { firstName: { contains: filters.q, mode: 'insensitive' } },
            { lastName: { contains: filters.q, mode: 'insensitive' } },
            { user: { email: { contains: filters.q.toLowerCase() } } },
          ],
        }
      : {}),
  };
  return {
    ...(filters.jobId ? { jobId: filters.jobId } : {}),
    ...(filters.destination ? { job: { destination: { code: filters.destination } } } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.appliedFrom || filters.appliedTo
      ? {
          appliedAt: {
            ...(filters.appliedFrom
              ? { gte: new Date(`${filters.appliedFrom}T00:00:00.000Z`) }
              : {}),
            ...(filters.appliedTo ? { lte: new Date(`${filters.appliedTo}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(Object.keys(candidate).length > 0 ? { candidate } : {}),
  };
}

const ORDER: Record<
  AdminApplicationListQuery['sort'],
  Prisma.ApplicationOrderByWithRelationInput[]
> = {
  newest: [{ appliedAt: 'desc' }, { id: 'asc' }],
  oldest: [{ appliedAt: 'asc' }, { id: 'asc' }],
  name: [{ candidate: { lastName: 'asc' } }, { candidate: { firstName: 'asc' } }, { id: 'asc' }],
  status: [{ status: 'asc' }, { appliedAt: 'desc' }, { id: 'asc' }],
};

interface StatusChange {
  id: string;
  from: ApplicationStatus;
  to: ApplicationStatus;
  email: string;
  locale: string;
  jobTitle: string;
  message: string | null;
}

@Injectable()
export class AdminApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly clock: Clock,
  ) {}

  async list(
    query: AdminApplicationListQuery,
    user: AuthUser,
  ): Promise<Paginated<AdminApplicationSummary>> {
    const where = applicationWhere(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: ORDER[query.sort],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.application.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toSummary(row, user)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(id: string, user: AuthUser): Promise<AdminApplicationDetail> {
    const row = await this.prisma.application.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!row) {
      throw notFound('Application not found');
    }
    return {
      ...this.toSummary(row, user),
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      coverLetter: row.coverLetter,
      answers: (row.answers as Record<string, string> | null) ?? null,
      profileSnapshot: (row.profileSnapshot as Record<string, unknown> | null) ?? {},
      documents: row.documents.map(({ document }) => ({
        id: document.id,
        type: document.type,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        deleted: document.deletedAt !== null,
      })),
      history: row.statusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        at: entry.createdAt.toISOString(),
        changedByEmail: entry.changedBy?.email ?? null,
        comment: entry.comment,
        messageToCandidate: entry.messageToCandidate,
      })),
      notes: row.notes.map((note) => ({
        id: note.id,
        body: note.body,
        authorId: note.authorId,
        authorEmail: note.author.email,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      })),
    };
  }

  /** One status change: state machine, history, hired count, audit entry, then the email. */
  async changeStatus(
    id: string,
    input: ChangeApplicationStatusInput,
    user: AuthUser,
    ip: string | null,
  ): Promise<AdminApplicationDetail> {
    const change = await this.applyChange(id, input, user, ip);
    await this.notifyCandidate(change);
    return this.get(id, user);
  }

  /**
   * The same change for several applications. Each one is its own transaction:
   * a refused application does not undo the others, and the result says which
   * ones changed and why the rest did not.
   */
  async bulkChangeStatus(
    input: BulkApplicationStatusInput,
    user: AuthUser,
    ip: string | null,
  ): Promise<BulkResult> {
    const results: BulkResult['results'] = [];
    for (const id of input.ids) {
      try {
        const change = await this.applyChange(id, input, user, ip);
        await this.notifyCandidate(change);
        results.push({ id, ok: true });
      } catch (error) {
        if (!(error instanceof AppException)) {
          throw error;
        }
        results.push({ id, ok: false, code: error.code, message: error.message });
      }
    }
    const changed = results.filter((result) => result.ok).length;
    return { changed, failed: results.length - changed, results };
  }

  private async applyChange(
    id: string,
    input: ChangeApplicationStatusInput,
    user: AuthUser,
    ip: string | null,
  ): Promise<StatusChange> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      // Row lock: two recruiters moving the same application are handled one after the other.
      const locked = await tx.$queryRaw<{ status: ApplicationStatus; job_id: string }[]>`
        SELECT status::text AS status, job_id FROM applications WHERE id = ${id}::uuid FOR UPDATE`;
      const current = locked[0];
      if (!current) {
        throw notFound('Application not found');
      }
      if (!canTransitionApplication(current.status, input.status, user.role)) {
        throw new AppException(
          'INVALID_APPLICATION_TRANSITION',
          HttpStatus.CONFLICT,
          `An application cannot go from ${current.status} to ${input.status}`,
          {
            from: current.status,
            to: input.status,
            allowed: allowedApplicationTransitions(current.status, user.role),
          },
        );
      }

      if (input.status === 'DEPLOYED') {
        // The candidate takes one of the positions; never more than the job has.
        const filled = await tx.job.updateMany({
          where: { id: current.job_id, hiredCount: { lt: tx.job.fields.positions } },
          data: { hiredCount: { increment: 1 } },
        });
        if (filled.count === 0) {
          throw new AppException(
            'NO_POSITION_LEFT',
            HttpStatus.CONFLICT,
            'Every position of this job is already filled',
          );
        }
      }

      const updated = await tx.application.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === 'UNDER_REVIEW' ? { withdrawnAt: null } : {}),
        },
        include: SUMMARY_INCLUDE,
      });
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: id,
          fromStatus: current.status,
          toStatus: input.status,
          changedById: user.id,
          comment: input.comment ?? null,
          messageToCandidate: input.messageToCandidate ?? null,
          createdAt: now,
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'application.change_status',
          entityType: 'application',
          entityId: id,
          before: { status: current.status },
          after: { status: input.status, hasMessageToCandidate: Boolean(input.messageToCandidate) },
          ip,
        },
        tx,
      );
      return {
        id,
        from: current.status,
        to: input.status,
        email: updated.candidate.user.email,
        locale: updated.candidate.user.locale,
        jobTitle: updated.job.title,
        message: input.messageToCandidate ?? null,
      };
    });
  }

  /** One email per step, in the candidate's language, with the optional message. Never the internal comment. */
  private async notifyCandidate(change: StatusChange): Promise<void> {
    const locale = localeSchema.catch('en').parse(change.locale);
    await this.mail.send(change.email, 'application-status', locale, {
      actionUrl: this.mail.linkFor('application-status', locale),
      jobTitle: change.jobTitle,
      status: change.to,
      message: change.message,
    });
  }

  // --- Internal notes -------------------------------------------------------

  async addNote(applicationId: string, body: string, user: AuthUser): Promise<{ id: string }> {
    if (
      !(await this.prisma.application.findUnique({
        where: { id: applicationId },
        select: { id: true },
      }))
    ) {
      throw notFound('Application not found');
    }
    return this.prisma.applicationNote.create({
      data: { applicationId, authorId: user.id, body },
      select: { id: true },
    });
  }

  async updateNote(
    applicationId: string,
    noteId: string,
    body: string,
    user: AuthUser,
  ): Promise<{ id: string }> {
    await this.ownNote(applicationId, noteId, user);
    return this.prisma.applicationNote.update({
      where: { id: noteId },
      data: { body },
      select: { id: true },
    });
  }

  async removeNote(applicationId: string, noteId: string, user: AuthUser): Promise<void> {
    await this.ownNote(applicationId, noteId, user);
    await this.prisma.applicationNote.delete({ where: { id: noteId } });
  }

  /** A note is changed or removed by its author, or by a super admin. */
  private async ownNote(applicationId: string, noteId: string, user: AuthUser): Promise<void> {
    const note = await this.prisma.applicationNote.findFirst({
      where: { id: noteId, applicationId },
      select: { authorId: true },
    });
    if (!note) {
      throw notFound('Note not found');
    }
    if (note.authorId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw forbidden('Only the author of a note can change it');
    }
  }

  private toSummary(row: SummaryRow, user: AuthUser): AdminApplicationSummary {
    return {
      id: row.id,
      status: row.status,
      appliedAt: row.appliedAt.toISOString(),
      job: {
        id: row.job.id,
        title: row.job.title,
        slug: row.job.slug,
        destinationCode: row.job.destination.code,
      },
      candidate: {
        id: row.candidate.id,
        firstName: row.candidate.firstName,
        lastName: row.candidate.lastName,
        email: row.candidate.user.email,
        nationality: row.candidate.nationality,
      },
      allowedTransitions: allowedApplicationTransitions(row.status, user.role),
    };
  }
}
