import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export type AuditSnapshot = Prisma.InputJsonObject;

/**
 * Reads the state of a record for the audit log. Each loader selects the fields
 * worth keeping, and nothing secret: no password hash, no token, no passport number.
 */
@Injectable()
export class AuditSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly loaders: Record<string, (id: string) => Promise<AuditSnapshot | null>> = {
    user: async (id) => {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          locale: true,
          tokenVersion: true,
          emailVerifiedAt: true,
          deletedAt: true,
        },
      });
      return user
        ? {
            ...user,
            emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
            deletedAt: user.deletedAt?.toISOString() ?? null,
          }
        : null;
    },
    job: async (id) => {
      const job = await this.prisma.job.findUnique({ where: { id } });
      if (!job) {
        return null;
      }
      // Long texts are left out: the entry records that they changed through `updatedAt`.
      return {
        id: job.id,
        slug: job.slug,
        title: job.title,
        status: job.status,
        featured: job.featured,
        destinationId: job.destinationId,
        categoryId: job.categoryId,
        employerName: job.employerName,
        showEmployerName: job.showEmployerName,
        salaryMin: job.salaryMin?.toNumber() ?? null,
        salaryMax: job.salaryMax?.toNumber() ?? null,
        salaryCurrency: job.salaryCurrency,
        salaryPeriod: job.salaryPeriod,
        positions: job.positions,
        hiredCount: job.hiredCount,
        requiredLanguages: job.requiredLanguages,
        deadline: job.deadline.toISOString(),
        coverImagePath: job.coverImagePath,
        publishedAt: job.publishedAt?.toISOString() ?? null,
        closedAt: job.closedAt?.toISOString() ?? null,
        deletedAt: job.deletedAt?.toISOString() ?? null,
        updatedAt: job.updatedAt.toISOString(),
      };
    },
    application: async (id) => {
      const row = await this.prisma.application.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          jobId: true,
          candidateId: true,
          _count: { select: { notes: true } },
        },
      });
      return row
        ? {
            id: row.id,
            status: row.status,
            jobId: row.jobId,
            candidateId: row.candidateId,
            notes: row._count.notes,
          }
        : null;
    },
    // Identifiers and state only: the entry says who looked at or changed whom, not their data.
    candidate: async (id) => {
      const row = await this.prisma.candidateProfile.findUnique({
        where: { id },
        select: { id: true, userId: true, user: { select: { isActive: true } } },
      });
      return row ? { id: row.id, userId: row.userId, isActive: row.user.isActive } : null;
    },
    successStory: async (id) => {
      const row = await this.prisma.successStory.findUnique({ where: { id } });
      return row
        ? {
            id: row.id,
            jobTitle: row.jobTitle,
            destinationId: row.destinationId,
            showFullName: row.showFullName,
            hasPhoto: row.photoPath !== null,
            hasConsentDocument: row.consentDocumentPath !== null,
            isPublished: row.isPublished,
            sortOrder: row.sortOrder,
            applicationId: row.applicationId,
          }
        : null;
    },
    homeSlide: async (id) => {
      const row = await this.prisma.homeSlide.findUnique({ where: { id } });
      return row
        ? {
            id: row.id,
            title: row.title as Prisma.InputJsonValue,
            imagePath: row.imagePath,
            ctaUrl: row.ctaUrl,
            destinationId: row.destinationId,
            sortOrder: row.sortOrder,
            isActive: row.isActive,
          }
        : null;
    },
    // No file name: it often contains the candidate's name.
    document: async (id) => {
      const row = await this.prisma.document.findUnique({ where: { id } });
      return row
        ? {
            id: row.id,
            candidateId: row.candidateId,
            type: row.type,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            sha256: row.sha256,
            deletedAt: row.deletedAt?.toISOString() ?? null,
          }
        : null;
    },
    destination: async (id) => {
      const row = await this.prisma.destination.findUnique({ where: { id } });
      return row
        ? {
            id: row.id,
            code: row.code,
            name: row.name as Prisma.InputJsonValue,
            icon: row.icon,
            isActive: row.isActive,
            sortOrder: row.sortOrder,
          }
        : null;
    },
    jobCategory: async (id) => {
      const row = await this.prisma.jobCategory.findUnique({ where: { id } });
      return row
        ? {
            id: row.id,
            slug: row.slug,
            name: row.name as Prisma.InputJsonValue,
            icon: row.icon,
            isActive: row.isActive,
          }
        : null;
    },
  };

  /** Null for an unknown entity type, an id that is not a UUID, or a missing record. */
  async load(entityType: string, id: string | null): Promise<AuditSnapshot | null> {
    const loader = this.loaders[entityType];
    if (!loader || !z.uuid().safeParse(id).success || id === null) {
      return null;
    }
    return loader(id);
  }
}
