import { Injectable } from '@nestjs/common';
import type {
  AdminCandidateDetail,
  AdminCandidateListQuery,
  AdminCandidateSummary,
  Paginated,
} from '@iconbridge/shared';
import { allowedApplicationTransitions } from '@iconbridge/shared';
import type { AuthUser } from '../../auth/auth.types.js';
import { SessionService } from '../../auth/session.service.js';
import { PROFILE_INCLUDE, ProfileService } from '../../candidates/profile.service.js';
import { notFound } from '../../common/errors/app.exception.js';
import { candidateScope } from '../../common/scope/candidate-scope.js';
import { toCandidateDocument } from '../../documents/documents.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const SUMMARY_INCLUDE = {
  user: {
    select: { id: true, email: true, isActive: true, emailVerifiedAt: true, createdAt: true },
  },
  _count: { select: { applications: true, documents: { where: { deletedAt: null } } } },
} satisfies Prisma.CandidateProfileInclude;

type SummaryRow = Prisma.CandidateProfileGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

const toSummary = (row: SummaryRow): AdminCandidateSummary => ({
  id: row.id,
  userId: row.user.id,
  firstName: row.firstName,
  lastName: row.lastName,
  email: row.user.email,
  nationality: row.nationality,
  countryOfResidence: row.countryOfResidence,
  currentProfession: row.currentProfession,
  passportNumberMasked: row.passportNumberMasked,
  isActive: row.user.isActive,
  emailVerified: row.user.emailVerifiedAt !== null,
  applicationCount: row._count.applications,
  documentCount: row._count.documents,
  registeredAt: row.user.createdAt.toISOString(),
});

/**
 * Candidates as the back office sees them. Erased accounts are not listed. A country agent
 * only reaches the candidates of his nationalities: the others answer 404 (ADR-024).
 */
@Injectable()
export class AdminCandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly sessions: SessionService,
  ) {}

  async list(
    query: AdminCandidateListQuery,
    viewer: AuthUser,
  ): Promise<Paginated<AdminCandidateSummary>> {
    const filters: Prisma.CandidateProfileWhereInput = {
      user: {
        role: 'CANDIDATE',
        deletedAt: null,
        ...(query.active === undefined ? {} : { isActive: query.active }),
      },
      ...(query.nationality ? { nationality: query.nationality } : {}),
      ...(query.language ? { languages: { some: { language: query.language } } } : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode: 'insensitive' } },
              { lastName: { contains: query.q, mode: 'insensitive' } },
              { user: { email: { contains: query.q.toLowerCase() } } },
            ],
          }
        : {}),
    };
    const where: Prisma.CandidateProfileWhereInput = { AND: [filters, candidateScope(viewer)] };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.candidateProfile.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.candidateProfile.count({ where }),
    ]);
    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async get(id: string, viewer: AuthUser): Promise<AdminCandidateDetail> {
    const row = await this.prisma.candidateProfile.findFirst({
      where: { id, user: { role: 'CANDIDATE', deletedAt: null }, ...candidateScope(viewer) },
      include: {
        ...SUMMARY_INCLUDE,
        ...PROFILE_INCLUDE,
        applications: {
          orderBy: { appliedAt: 'desc' },
          include: {
            job: {
              select: {
                id: true,
                title: true,
                slug: true,
                destination: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    if (!row) {
      throw notFound('Candidate not found');
    }
    const documents = await this.prisma.document.findMany({
      where: { candidateId: id, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
    const summary = toSummary(row);
    return {
      ...summary,
      // Masked here for every role; the clear number is given by the audited reveal action.
      profile: this.profiles.toResponse(row, { revealPassport: false }),
      documents: documents.map(toCandidateDocument),
      applications: row.applications.map((application) => ({
        id: application.id,
        status: application.status,
        appliedAt: application.appliedAt.toISOString(),
        job: {
          id: application.job.id,
          title: application.job.title,
          slug: application.job.slug,
          destinationCode: application.job.destination.code,
        },
        candidate: {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          email: summary.email,
          nationality: row.nationality,
        },
        allowedTransitions: allowedApplicationTransitions(application.status, viewer.role),
      })),
    };
  }

  revealPassport(id: string): Promise<string | null> {
    return this.profiles.revealPassportNumber(id);
  }

  /** Disabling signs the candidate out at once; their data and applications stay. */
  async setActive(id: string, active: boolean): Promise<AdminCandidateSummary> {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id, user: { role: 'CANDIDATE', deletedAt: null } },
      select: { userId: true },
    });
    if (!profile) {
      throw notFound('Candidate not found');
    }
    await this.prisma.$transaction(async (tx) => {
      if (!active) {
        await this.sessions.endAll(profile.userId, tx);
      }
      await tx.user.update({
        where: { id: profile.userId },
        data: active ? { isActive: true } : { isActive: false, tokenVersion: { increment: 1 } },
      });
    });
    return toSummary(
      await this.prisma.candidateProfile.findUniqueOrThrow({
        where: { id },
        include: SUMMARY_INCLUDE,
      }),
    );
  }
}
