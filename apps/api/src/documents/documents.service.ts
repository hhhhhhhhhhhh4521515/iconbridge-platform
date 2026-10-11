import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_APPLICATION_STATUSES,
  MAX_DOCUMENTS_PER_CANDIDATE,
  type CandidateDocument,
  type DocumentType,
} from '@iconbridge/shared';
import { AppException, notFound } from '../common/errors/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { decodeUploadName, inspectDocument, sanitizeFileName } from './file-inspection.js';

type DocumentRow = Prisma.DocumentGetPayload<object>;

export const toCandidateDocument = (row: DocumentRow): CandidateDocument => ({
  id: row.id,
  type: row.type,
  originalName: row.originalName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  uploadedAt: row.uploadedAt.toISOString(),
});

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  async listOwn(userId: string): Promise<CandidateDocument[]> {
    const rows = await this.prisma.document.findMany({
      where: { candidate: { userId }, deletedAt: null },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toCandidateDocument);
  }

  /**
   * Stores a candidate document in the private container under a random name.
   * The original name only lives in the database.
   */
  async upload(
    userId: string,
    type: DocumentType,
    file: { buffer: Buffer; originalname?: string },
  ): Promise<CandidateDocument> {
    const maxBytes = (await this.settings.get('MAX_UPLOAD_SIZE_MB')) * 1024 * 1024;
    if (file.buffer.length === 0 || file.buffer.length > maxBytes) {
      throw new AppException(
        'FILE_TOO_LARGE',
        HttpStatus.PAYLOAD_TOO_LARGE,
        'The file is empty or too large',
        { maxBytes },
      );
    }
    const inspected = await inspectDocument(file.buffer, type);

    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: { id: true, _count: { select: { documents: { where: { deletedAt: null } } } } },
    });
    if (!profile) {
      throw notFound('Candidate profile not found');
    }
    if (profile._count.documents >= MAX_DOCUMENTS_PER_CANDIDATE) {
      throw new AppException(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `You can keep at most ${MAX_DOCUMENTS_PER_CANDIDATE} documents. Delete one first.`,
      );
    }

    const blobPath = `candidates/${profile.id}/${randomUUID()}.${inspected.format}`;
    await this.storage.uploadPrivate(blobPath, file.buffer, inspected.mimeType);
    try {
      const row = await this.prisma.document.create({
        data: {
          candidateId: profile.id,
          type,
          blobPath,
          originalName: sanitizeFileName(decodeUploadName(file.originalname), inspected.format),
          mimeType: inspected.mimeType,
          sizeBytes: file.buffer.length,
          sha256: inspected.sha256,
        },
      });
      return toCandidateDocument(row);
    } catch (error) {
      // Do not leave a file nobody can reach or delete.
      await this.storage.deletePrivate(blobPath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Soft delete. Refused while an application in progress relies on the document.
   * The file itself is removed when no application ever used it; otherwise it
   * stays with the finished applications it belongs to.
   */
  async removeOwn(id: string): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: { applications: { select: { application: { select: { status: true } } } } },
    });
    if (!document) {
      throw notFound('Document not found');
    }
    const active: readonly string[] = ACTIVE_APPLICATION_STATUSES;
    if (document.applications.some((link) => active.includes(link.application.status))) {
      throw new AppException(
        'DOCUMENT_IN_USE',
        HttpStatus.CONFLICT,
        'This document is attached to an application in progress',
      );
    }
    await this.prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    if (document.applications.length === 0) {
      try {
        await this.storage.deletePrivate(document.blobPath);
      } catch (error) {
        this.logger.error(
          `File of deleted document ${id} not removed: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    }
  }

  /** A read-only link to the file, valid 5 minutes. Access is decided before, by the guards. */
  async downloadUrl(id: string, inline = false): Promise<string> {
    const document = await this.prisma.document.findFirst({ where: { id, deletedAt: null } });
    if (!document) {
      throw notFound('Document not found');
    }
    return this.storage.privateDownloadUrl(document.blobPath, {
      fileName: document.originalName,
      contentType: document.mimeType,
      inline,
    });
  }
}
