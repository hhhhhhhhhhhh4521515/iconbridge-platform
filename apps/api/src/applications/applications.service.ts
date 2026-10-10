import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ACTIVE_APPLICATION_STATUSES,
  canWithdrawApplication,
  isPassportExpired,
  isPassportExpiringSoon,
  profileCompleteness,
  utcDateString,
  WITHDRAWABLE_STATUSES,
  type ApplyInput,
  type CandidateApplication,
  type Eligibility,
  type IneligibilityReason,
  type ProfileItem,
} from '@iconbridge/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { TurnstileService } from '../auth/turnstile.service.js';
import { dateOnly, ProfileService, type ProfileRow } from '../candidates/profile.service.js';
import { Clock } from '../common/clock/clock.js';
import { AppException, notFound } from '../common/errors/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { OPEN_JOB_SQL } from '../jobs/public-jobs.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { isInCooldown, nextAllowedApplicationDate } from './cooldown.js';

const APPLICATION_INCLUDE = {
  job: { select: { id: true, slug: true, title: true, destination: { select: { code: true } } } },
  documents: { select: { document: { select: { id: true, type: true, originalName: true } } } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ApplicationInclude;

type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

/** What a candidate sees: no internal note, no recruiter comment, no author of a status change. */
function toCandidateApplication(row: ApplicationRow): CandidateApplication {
  return {
    id: row.id,
    status: row.status,
    appliedAt: row.appliedAt.toISOString(),
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    canWithdraw: canWithdrawApplication(row.status),
    coverLetter: row.coverLetter,
    job: {
      id: row.job.id,
      slug: row.job.slug,
      title: row.job.title,
      destinationCode: row.job.destination.code,
    },
    documents: row.documents.map((link) => link.document),
    history: row.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      at: entry.createdAt.toISOString(),
    })),
  };
}

interface JobState {
  id: string;
  title: string;
  /** False for a job a candidate must not know about: missing, deleted or never published. */
  known: boolean;
  open: boolean;
}

interface Evaluation extends Eligibility {
  job: JobState | null;
  profile: ProfileRow;
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly turnstile: TurnstileService,
    private readonly mail: MailService,
  ) {}

  /** What the job page needs to show the right button. Never creates anything. */
  async eligibility(user: AuthUser, jobId: string): Promise<Eligibility> {
    const evaluation = await this.evaluate(this.prisma, user, jobId);
    if (!evaluation.job?.known) {
      throw notFound('Job not found');
    }
    const { job: _job, profile: _profile, ...eligibility } = evaluation;
    return eligibility;
  }

  async apply(
    user: AuthUser,
    jobId: string,
    input: ApplyInput,
    ip: string | null,
  ): Promise<CandidateApplication> {
    if (!(await this.turnstile.verify(input.turnstileToken, ip))) {
      throw new AppException('CAPTCHA_FAILED', HttpStatus.BAD_REQUEST, 'The CAPTCHA check failed');
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        const profile = await this.profiles.findByUser(user.id, tx);
        // Requests of one candidate are handled one at a time: first all of them
        // (the limit of active applications), then per job (the re-application rule).
        // The locks are released when the transaction ends. A double click therefore
        // waits here, then sees the application the first request created.
        await this.lock(tx, `candidate:${profile.id}`);
        await this.lock(tx, `application:${profile.id}:${jobId}`);

        const evaluation = await this.evaluate(tx, user, jobId);
        this.assertEligible(evaluation);
        const job = evaluation.job;
        if (!job) {
          throw notFound('Job not found');
        }

        const documents = await tx.document.findMany({
          where: { id: { in: input.documentIds }, candidateId: profile.id, deletedAt: null },
        });
        const types = new Set(documents.map((document) => document.type));
        if (
          documents.length !== input.documentIds.length ||
          !types.has('CV') ||
          !types.has('PASSPORT')
        ) {
          throw new AppException(
            'VALIDATION_ERROR',
            HttpStatus.BAD_REQUEST,
            'The request is invalid',
            [
              {
                path: 'documentIds',
                message: 'Select your own documents, including a CV and a passport scan',
              },
            ],
          );
        }

        const now = this.clock.now();
        const application = await tx.application.create({
          data: {
            jobId,
            candidateId: profile.id,
            coverLetter: input.coverLetter ?? null,
            ...(input.answers ? { answers: input.answers } : {}),
            appliedAt: now,
            profileSnapshot: this.snapshot(evaluation.profile, documents),
            documents: { create: documents.map((document) => ({ documentId: document.id })) },
            statusHistory: {
              create: {
                fromStatus: null,
                toStatus: 'SUBMITTED',
                changedById: user.id,
                createdAt: now,
              },
            },
          },
          include: APPLICATION_INCLUDE,
        });
        return { application, jobTitle: job.title };
      },
      { timeout: 15_000 },
    );

    await this.notify(user, created.application.id, created.jobTitle);
    return toCandidateApplication(created.application);
  }

  async listOwn(userId: string): Promise<CandidateApplication[]> {
    const rows = await this.prisma.application.findMany({
      where: { candidate: { userId } },
      include: APPLICATION_INCLUDE,
      orderBy: [{ appliedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toCandidateApplication);
  }

  /** Allowed until the contract is signed. The application stays, with the status WITHDRAWN. */
  async withdrawOwn(user: AuthUser, id: string): Promise<CandidateApplication> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.application.findUnique({ where: { id }, select: { status: true } });
      if (!current) {
        throw notFound('Application not found');
      }
      // Conditional update: a recruiter may move the application at the same moment.
      const updated = await tx.application.updateMany({
        where: { id, status: { in: [...WITHDRAWABLE_STATUSES] } },
        data: { status: 'WITHDRAWN', withdrawnAt: now },
      });
      if (updated.count === 0) {
        throw new AppException(
          'CANNOT_WITHDRAW',
          HttpStatus.CONFLICT,
          'This application can no longer be withdrawn',
          { status: current.status },
        );
      }
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: id,
          fromStatus: current.status,
          toStatus: 'WITHDRAWN',
          changedById: user.id,
          createdAt: now,
        },
      });
      return tx.application.findUniqueOrThrow({ where: { id }, include: APPLICATION_INCLUDE });
    });
    return toCandidateApplication(row);
  }

  /**
   * Every reason why this candidate cannot apply to this job now. Used as is by the
   * eligibility endpoint and, inside the locked transaction, by `apply`: the two
   * can never disagree.
   */
  private async evaluate(
    client: Prisma.TransactionClient,
    user: AuthUser,
    jobId: string,
  ): Promise<Evaluation> {
    const now = this.clock.now();
    const today = utcDateString(now);
    const profile = await this.profiles.findByUser(user.id, client);
    const reasons: IneligibilityReason[] = [];

    if (!user.emailVerified) {
      reasons.push('EMAIL_NOT_VERIFIED');
    }

    const completeness = profileCompleteness({
      ...profile,
      passportNumber: profile.passportNumberEncrypted,
      documentTypes: profile.documents.map((document) => document.type),
    });
    const missing: ProfileItem[] = completeness.missingToApply;
    if (missing.length > 0) {
      reasons.push('PROFILE_INCOMPLETE');
    }

    const expiry = dateOnly(profile.passportExpiryDate);
    if (expiry && isPassportExpired(expiry, today)) {
      reasons.push('PASSPORT_EXPIRED');
    }

    const [jobRow] = await client.$queryRaw<
      { id: string; title: string; status: string; deleted: boolean; open: boolean }[]
    >`
      SELECT j.id, j.title, j.status::text AS status, j.deleted_at IS NOT NULL AS deleted,
             (${OPEN_JOB_SQL}) AS open
      FROM jobs j WHERE j.id = ${jobId}::uuid`;
    const job: JobState | null = jobRow
      ? {
          id: jobRow.id,
          title: jobRow.title,
          known: !jobRow.deleted && jobRow.status !== 'DRAFT',
          open: jobRow.open,
        }
      : null;
    if (!job?.open) {
      reasons.push('JOB_NOT_OPEN');
    }

    // The 6-month rule: the latest application to this job counts, whatever became of it.
    const last = await client.application.findFirst({
      where: { candidateId: profile.id, jobId },
      orderBy: { appliedAt: 'desc' },
      select: { appliedAt: true },
    });
    let nextAllowedAt: Date | null = null;
    if (last) {
      const months = await this.settings.get('REAPPLY_COOLDOWN_MONTHS', client);
      if (isInCooldown(last.appliedAt, months, now)) {
        nextAllowedAt = nextAllowedApplicationDate(last.appliedAt, months);
        reasons.push('REAPPLY_COOLDOWN');
      }
    }

    const active = await client.application.count({
      where: { candidateId: profile.id, status: { in: [...ACTIVE_APPLICATION_STATUSES] } },
    });
    if (active >= (await this.settings.get('MAX_ACTIVE_APPLICATIONS', client))) {
      reasons.push('MAX_ACTIVE_APPLICATIONS');
    }

    return {
      canApply: reasons.length === 0,
      reasons,
      nextAllowedAt: nextAllowedAt?.toISOString() ?? null,
      lastAppliedAt: last?.appliedAt.toISOString() ?? null,
      missing,
      passportExpiringSoon: expiry ? isPassportExpiringSoon(expiry, now) : false,
      job,
      profile,
    };
  }

  /** Turns the first applicable reason into the error of POST /jobs/:id/apply. */
  private assertEligible(evaluation: Evaluation): void {
    const has = (reason: IneligibilityReason) => evaluation.reasons.includes(reason);
    if (!evaluation.job?.known) {
      throw notFound('Job not found');
    }
    if (has('REAPPLY_COOLDOWN') && evaluation.nextAllowedAt) {
      throw new AppException(
        'REAPPLY_COOLDOWN',
        HttpStatus.CONFLICT,
        'You already applied to this job. You can apply again after the waiting period.',
        { lastAppliedAt: evaluation.lastAppliedAt, nextAllowedAt: evaluation.nextAllowedAt },
        { nextAllowedAt: evaluation.nextAllowedAt },
      );
    }
    if (has('JOB_NOT_OPEN')) {
      throw new AppException(
        'JOB_NOT_OPEN',
        HttpStatus.CONFLICT,
        'This job no longer accepts applications',
      );
    }
    if (has('EMAIL_NOT_VERIFIED')) {
      throw new AppException(
        'EMAIL_NOT_VERIFIED',
        HttpStatus.FORBIDDEN,
        'Verify your email address first',
      );
    }
    if (has('PROFILE_INCOMPLETE')) {
      throw new AppException(
        'PROFILE_INCOMPLETE',
        HttpStatus.CONFLICT,
        'Complete your profile before applying',
        { missing: evaluation.missing },
      );
    }
    if (has('PASSPORT_EXPIRED')) {
      throw new AppException(
        'PASSPORT_EXPIRED',
        HttpStatus.CONFLICT,
        'Your passport has expired. Update it before applying.',
      );
    }
    if (has('MAX_ACTIVE_APPLICATIONS')) {
      throw new AppException(
        'MAX_ACTIVE_APPLICATIONS',
        HttpStatus.CONFLICT,
        'You have reached the maximum number of applications in progress',
      );
    }
  }

  /** Waits for a transaction-level advisory lock named by `key`. */
  private async lock(tx: Prisma.TransactionClient, key: string): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
  }

  /**
   * The profile and the documents as they were when applying, so later edits do not
   * rewrite history. Holds the masked passport number, never the clear or encrypted one.
   */
  private snapshot(
    profile: ProfileRow,
    documents: {
      id: string;
      type: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
    }[],
  ): Prisma.InputJsonObject {
    return {
      firstName: profile.firstName,
      lastName: profile.lastName,
      gender: profile.gender,
      dateOfBirth: dateOnly(profile.dateOfBirth),
      nationality: profile.nationality,
      countryOfResidence: profile.countryOfResidence,
      city: profile.city,
      phone: profile.phone,
      whatsapp: profile.whatsapp,
      passportNumberMasked: profile.passportNumberMasked,
      passportIssuingCountry: profile.passportIssuingCountry,
      passportIssueDate: dateOnly(profile.passportIssueDate),
      passportExpiryDate: dateOnly(profile.passportExpiryDate),
      currentProfession: profile.currentProfession,
      yearsOfExperience: profile.yearsOfExperience,
      educationLevel: profile.educationLevel,
      languages: profile.languages.map(({ language, level }) => ({ language, level })),
      drivingLicenceCategories: profile.drivingLicenceCategories,
      hasStcwTraining: profile.hasStcwTraining,
      hasSeamanBook: profile.hasSeamanBook,
      hasMedicalCertificate: profile.hasMedicalCertificate,
      seaExperience: profile.seaExperience,
      documents: documents.map((document) => ({
        id: document.id,
        type: document.type,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        sha256: document.sha256,
      })),
    };
  }

  /** Confirmation to the candidate, and a notice to every active recruiter and super admin. */
  private async notify(user: AuthUser, applicationId: string, jobTitle: string): Promise<void> {
    await this.mail.send(user.email, 'application-received', user.locale, {
      actionUrl: this.mail.linkFor('application-received', user.locale),
      jobTitle,
    });
    const recruiters = await this.prisma.user.findMany({
      // Accounts that accepted their invitation (they have a password) and are active.
      where: {
        role: { in: ['RECRUITER', 'SUPER_ADMIN'] },
        isActive: true,
        deletedAt: null,
        passwordHash: { not: null },
      },
      select: { email: true, locale: true },
    });
    for (const recruiter of recruiters) {
      const locale =
        recruiter.locale === 'fr' || recruiter.locale === 'ar' ? recruiter.locale : 'en';
      // No personal data in the email: the recruiter opens the application in the back office.
      await this.mail.send(recruiter.email, 'new-application', locale, {
        actionUrl: this.mail.linkFor('new-application', locale, undefined, applicationId),
        jobTitle,
      });
    }
  }
}
