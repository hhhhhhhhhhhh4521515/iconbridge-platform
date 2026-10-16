import { randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_APPLICATION_STATUSES,
  type AccountSettingsInput,
  type ChangePasswordInput,
  type MyJobAlert,
  type MyJobAlertInput,
} from '@iconbridge/shared';
import type { Archiver } from 'archiver';
import { ApplicationsService } from '../applications/applications.service.js';
import { ProfileService } from '../candidates/profile.service.js';
import { Clock } from '../common/clock/clock.js';
import { PasswordPolicyService } from '../auth/password-policy.service.js';
import { SessionService } from '../auth/session.service.js';
import { hashPassword, verifyPassword } from '../common/crypto/password.js';
import { AppException, notFound } from '../common/errors/app.exception.js';
import { DocumentsService } from '../documents/documents.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const MAX_ALERTS_PER_USER = 10;

/** Characters that are safe in a file name inside a zip on every system. */
const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || 'file';

/** GDPR rights of a candidate: a copy of their data, and erasure. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly profiles: ProfileService,
    private readonly documents: DocumentsService,
    private readonly applications: ApplicationsService,
    private readonly clock: Clock,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * A zip with `data.json` (account, profile with the clear passport number,
   * documents, applications as the candidate sees them) and the uploaded files
   * under `documents/`. Internal notes are not personal data of the candidate's
   * making and are not included.
   */
  async export(userId: string): Promise<Archiver> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true,
        role: true,
        locale: true,
        createdAt: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
      },
    });
    const profile = await this.profiles.getOwn(userId);
    const documents = await this.prisma.document.findMany({
      where: { candidate: { userId }, deletedAt: null },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
    });
    const applications = await this.prisma.application.findMany({
      where: { candidate: { userId } },
      select: { id: true, answers: true },
    });
    const answers = new Map(
      applications.map((application) => [application.id, application.answers]),
    );

    const files = documents.map((document, index) => ({
      document,
      path: `documents/${String(index + 1).padStart(2, '0')}-${document.type}-${safeName(document.originalName)}`,
    }));

    // Loaded with the first export, not when the API starts.
    const { ZipArchive } = await import('archiver');
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.append(
      JSON.stringify(
        {
          exportedAt: this.clock.now().toISOString(),
          account: user,
          profile,
          documents: files.map(({ document, path }) => ({
            id: document.id,
            type: document.type,
            originalName: document.originalName,
            mimeType: document.mimeType,
            sizeBytes: document.sizeBytes,
            sha256: document.sha256,
            uploadedAt: document.uploadedAt,
            file: path,
          })),
          applications: (await this.applications.listOwn(userId)).map((application) => ({
            ...application,
            answers: answers.get(application.id) ?? null,
          })),
        },
        null,
        2,
      ),
      { name: 'data.json' },
    );
    for (const { document, path } of files) {
      archive.append(await this.storage.readPrivate(document.blobPath), { name: path });
    }
    void archive.finalize();
    return archive;
  }

  /** Language of the emails sent to the user. */
  async updateSettings(userId: string, input: AccountSettingsInput): Promise<AccountSettingsInput> {
    await this.prisma.user.update({ where: { id: userId }, data: { locale: input.locale } });
    return { locale: input.locale };
  }

  /**
   * Changes the password of a signed-in user. The current password is required, the
   * new one follows the same strength rule as at registration, and every session and
   * access token issued before stops working: the caller signs the user in again.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<{ tokenVersion: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, passwordHash: true },
    });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppException('INVALID_CREDENTIALS', HttpStatus.FORBIDDEN, 'Wrong password');
    }
    this.passwordPolicy.assertStrong(input.newPassword, [user.email]);
    const passwordHash = await hashPassword(input.newPassword);
    return this.prisma.$transaction(async (tx) => {
      await this.sessions.endAll(userId, tx);
      return tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
        select: { tokenVersion: true },
      });
    });
  }

  // --- Job alerts of the signed-in candidate (matched by their email address) ---

  async listJobAlerts(email: string): Promise<MyJobAlert[]> {
    const [rows, destinations, categories] = await Promise.all([
      this.prisma.jobAlertSubscription.findMany({
        where: { email },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.destination.findMany({ select: { id: true, code: true } }),
      this.prisma.jobCategory.findMany({ select: { id: true, slug: true } }),
    ]);
    const codes = new Map(destinations.map((row) => [row.id, row.code]));
    const slugs = new Map(categories.map((row) => [row.id, row.slug]));
    return rows.map((row) => ({
      id: row.id,
      destinations: row.destinationIds.flatMap((id) => codes.get(id) ?? []),
      categories: row.categoryIds.flatMap((id) => slugs.get(id) ?? []),
      confirmed: row.confirmedAt !== null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Active at once: the address of a signed-in, verified user needs no second confirmation. */
  async createJobAlert(
    user: { email: string; locale: string },
    input: MyJobAlertInput,
  ): Promise<MyJobAlert[]> {
    const existing = await this.prisma.jobAlertSubscription.count({ where: { email: user.email } });
    if (existing >= MAX_ALERTS_PER_USER) {
      throw new AppException(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `You can have at most ${MAX_ALERTS_PER_USER} job alerts`,
      );
    }
    const [destinations, categories] = await Promise.all([
      this.prisma.destination.findMany({
        where: { code: { in: input.destinations }, isActive: true },
        select: { id: true },
      }),
      this.prisma.jobCategory.findMany({
        where: { slug: { in: input.categories }, isActive: true },
        select: { id: true },
      }),
    ]);
    await this.prisma.jobAlertSubscription.create({
      data: {
        email: user.email,
        locale: user.locale,
        destinationIds: destinations.map((row) => row.id),
        categoryIds: categories.map((row) => row.id),
        confirmedAt: this.clock.now(),
        unsubscribeToken: randomBytes(32).toString('base64url'),
      },
    });
    return this.listJobAlerts(user.email);
  }

  /** Only an alert of the same email address can be removed; anything else answers 404. */
  async removeJobAlert(email: string, id: string): Promise<void> {
    const removed = await this.prisma.jobAlertSubscription.deleteMany({ where: { id, email } });
    if (removed.count === 0) {
      throw notFound('Job alert not found');
    }
  }

  /**
   * Erases a candidate. Files are deleted first: if storage fails, nothing has
   * changed and the request can be repeated. Then, in one transaction, everything
   * that identifies the person is removed or overwritten. What remains is
   * anonymous: one row per application with its job, dates and status, for statistics.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppException('INVALID_CREDENTIALS', HttpStatus.FORBIDDEN, 'Wrong password');
    }
    await this.eraseCandidate(userId);
  }

  /**
   * The erasure itself, also used when the back office deletes a candidate. Returns
   * what was removed, as counts only.
   */
  async eraseCandidate(
    userId: string,
  ): Promise<{ profileId: string | null; documents: number; applications: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true,
        candidateProfile: {
          select: { id: true, documents: { select: { blobPath: true, deletedAt: true } } },
        },
      },
    });
    const profileId = user.candidateProfile?.id;

    for (const document of user.candidateProfile?.documents ?? []) {
      await this.storage.deletePrivate(document.blobPath);
    }

    const now = this.clock.now();
    let applicationCount = 0;
    await this.prisma.$transaction(async (tx) => {
      if (profileId) {
        const applications = await tx.application.findMany({
          where: { candidateId: profileId },
          select: { id: true, status: true },
        });
        const active: readonly string[] = ACTIVE_APPLICATION_STATUSES;
        for (const application of applications.filter((a) => active.includes(a.status))) {
          await tx.application.update({
            where: { id: application.id },
            data: { status: 'WITHDRAWN', withdrawnAt: now },
          });
          await tx.applicationStatusHistory.create({
            data: {
              applicationId: application.id,
              fromStatus: application.status,
              toStatus: 'WITHDRAWN',
              createdAt: now,
            },
          });
        }
        applicationCount = applications.length;
        const ids = applications.map((application) => application.id);
        await tx.application.updateMany({
          where: { id: { in: ids } },
          data: { coverLetter: null, answers: Prisma.DbNull, profileSnapshot: {} },
        });
        // Free text written about the person.
        await tx.applicationNote.deleteMany({ where: { applicationId: { in: ids } } });
        await tx.applicationStatusHistory.updateMany({
          where: { applicationId: { in: ids } },
          data: { comment: null },
        });
        // Deleting the rows also removes their links to applications.
        await tx.document.deleteMany({ where: { candidateId: profileId } });
        await tx.candidateLanguage.deleteMany({ where: { candidateId: profileId } });
        await tx.candidateProfile.update({
          where: { id: profileId },
          data: {
            firstName: 'Deleted',
            lastName: 'User',
            gender: null,
            dateOfBirth: null,
            nationality: null,
            countryOfResidence: null,
            city: null,
            phone: null,
            whatsapp: null,
            passportNumberEncrypted: null,
            passportNumberMasked: null,
            passportIssuingCountry: null,
            passportIssueDate: null,
            passportExpiryDate: null,
            currentProfession: null,
            yearsOfExperience: null,
            educationLevel: null,
            drivingLicenceCategories: [],
            preferredDestinations: [],
            hasStcwTraining: false,
            hasSeamanBook: false,
            hasMedicalCertificate: false,
            seaExperience: null,
            gdprConsentAt: null,
          },
        });
      }
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.emailToken.deleteMany({ where: { userId } });
      await tx.jobAlertSubscription.deleteMany({ where: { email: user.email } });
      await tx.user.update({
        where: { id: userId },
        data: {
          // Frees the address: the person can register again later.
          email: `deleted-${randomUUID()}@deleted.invalid`,
          passwordHash: null,
          isActive: false,
          emailVerifiedAt: null,
          lastLoginAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
          tokenVersion: { increment: 1 },
          deletedAt: now,
        },
      });
    });
    this.logger.log(`Candidate account erased (user ${userId})`);
    return {
      profileId: profileId ?? null,
      documents: (user.candidateProfile?.documents ?? []).filter((d) => d.deletedAt === null)
        .length,
      applications: applicationCount,
    };
  }
}
