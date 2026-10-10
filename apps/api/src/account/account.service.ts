import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ACTIVE_APPLICATION_STATUSES } from '@iconbridge/shared';
import { ZipArchive, type Archiver } from 'archiver';
import { ApplicationsService } from '../applications/applications.service.js';
import { ProfileService } from '../candidates/profile.service.js';
import { Clock } from '../common/clock/clock.js';
import { verifyPassword } from '../common/crypto/password.js';
import { AppException } from '../common/errors/app.exception.js';
import { DocumentsService } from '../documents/documents.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

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

  /**
   * Erases a candidate. Files are deleted first: if storage fails, nothing has
   * changed and the request can be repeated. Then, in one transaction, everything
   * that identifies the person is removed or overwritten. What remains is
   * anonymous: one row per application with its job, dates and status, for statistics.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true,
        passwordHash: true,
        candidateProfile: { select: { id: true, documents: { select: { blobPath: true } } } },
      },
    });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppException('INVALID_CREDENTIALS', HttpStatus.FORBIDDEN, 'Wrong password');
    }
    const profileId = user.candidateProfile?.id;

    for (const document of user.candidateProfile?.documents ?? []) {
      await this.storage.deletePrivate(document.blobPath);
    }

    const now = this.clock.now();
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
  }
}
