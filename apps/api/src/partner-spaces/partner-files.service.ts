import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  PARTNER_FILE_FORMATS,
  type PartnerFile,
  type PartnerFileKind,
  type PartnerFileLink,
} from '@iconbridge/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { Clock } from '../common/clock/clock.js';
import { AppException, notFound } from '../common/errors/app.exception.js';
import { decodeUploadName, inspectUpload, sanitizeFileName } from '../documents/file-inspection.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JobCoverService } from '../jobs/job-cover.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  DOWNLOAD_LINK_TTL_SECONDS,
  PARTNER_FILES_CONTAINER,
  StorageService,
} from '../storage/storage.service.js';
import { actorOf, PartnerHistoryService, type PartnerActor } from './partner-history.service.js';

/** A logo is shown small, in the header of the partner area. */
const LOGO_MAX_WIDTH = 400;
/** Formats a browser displays itself; a DOCX is always saved. */
const PREVIEWABLE = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export const PARTNER_FILE_SELECT = {
  id: true,
  kind: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { email: true, displayName: true } },
} satisfies Prisma.PartnerFileSelect;

type FileRow = Prisma.PartnerFileGetPayload<{ select: typeof PARTNER_FILE_SELECT }>;

export function toPartnerFile(row: FileRow): PartnerFile {
  return {
    id: row.id,
    kind: row.kind,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy ? (row.uploadedBy.displayName ?? row.uploadedBy.email) : null,
    // A replacement updates the row: its time is the upload of the current file.
    uploadedAt: row.updatedAt.toISOString(),
  };
}

/** Every path of a space starts with this prefix: deleting the space deletes it all. */
export const spacePrefix = (spaceId: string): string => `spaces/${spaceId}/`;

const fileNotFound = () => notFound('File not found');

const storageUnavailable = () =>
  new AppException(
    'STORAGE_UNAVAILABLE',
    HttpStatus.SERVICE_UNAVAILABLE,
    'The files could not be deleted. Nothing was deleted; try again later.',
  );

/**
 * Files of the partner spaces (ADR-027, section 5): the passport, CV and work permit of an
 * application, and the space's logo, in the private partner-files container under
 * spaces/<spaceId>/<random>. The checks of candidate documents apply. Every query names the
 * space, so a file of another space is never found.
 */
@Injectable()
export class PartnerFilesService {
  private readonly logger = new Logger(PartnerFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly history: PartnerHistoryService,
    private readonly images: JobCoverService,
    private readonly clock: Clock,
  ) {}

  /** Upload or replace the file of one kind; the replaced file's blob is deleted. */
  async upload(
    spaceId: string,
    applicationId: string,
    kind: PartnerFileKind,
    file: { buffer: Buffer; originalname?: string },
    user: AuthUser,
  ): Promise<PartnerFile> {
    const maxBytes = (await this.settings.get('MAX_UPLOAD_SIZE_MB')) * 1024 * 1024;
    if (file.buffer.length === 0 || file.buffer.length > maxBytes) {
      throw new AppException(
        'FILE_TOO_LARGE',
        HttpStatus.PAYLOAD_TOO_LARGE,
        'The file is empty or too large',
        { maxBytes },
      );
    }
    const application = await this.prisma.partnerApplication.findFirst({
      where: { id: applicationId, partnerSpaceId: spaceId },
      select: { id: true },
    });
    if (!application) {
      throw notFound('Application not found');
    }
    const inspected = await inspectUpload(file.buffer, PARTNER_FILE_FORMATS[kind], {
      fileKind: kind,
    });
    const originalName = sanitizeFileName(decodeUploadName(file.originalname), inspected.format);
    const storagePath = `${spacePrefix(spaceId)}${randomUUID()}.${inspected.format}`;
    const actor = actorOf(user);

    await this.storage.uploadPrivate(
      storagePath,
      inspected.content,
      inspected.mimeType,
      PARTNER_FILES_CONTAINER,
    );
    let saved: { id: string; replacedPath: string | null };
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const current = await tx.partnerFile.findFirst({
          where: { partnerSpaceId: spaceId, partnerApplicationId: applicationId, kind },
          select: { id: true, storagePath: true, originalName: true },
        });
        const data = {
          format: inspected.format,
          mimeType: inspected.mimeType,
          sizeBytes: inspected.content.length,
          sha256: inspected.sha256,
          storagePath,
          originalName,
          uploadedById: user.id,
        };
        let id: string;
        if (current) {
          const updated = await tx.partnerFile.updateMany({
            where: { id: current.id, partnerSpaceId: spaceId },
            data,
          });
          if (updated.count !== 1) {
            throw fileNotFound();
          }
          id = current.id;
        } else {
          ({ id } = await tx.partnerFile.create({
            data: {
              ...data,
              partnerSpaceId: spaceId,
              partnerApplicationId: applicationId,
              kind,
            },
            select: { id: true },
          }));
        }
        await this.history.record(tx, {
          spaceId,
          actor,
          entityType: 'file',
          entityId: id,
          applicationId,
          action: current ? 'FILE_REPLACED' : 'FILE_UPLOADED',
          changes: [
            { field: 'kind', oldValue: current ? kind : null, newValue: kind },
            {
              field: 'originalName',
              oldValue: current?.originalName ?? null,
              newValue: originalName,
            },
          ],
        });
        return { id, replacedPath: current?.storagePath ?? null };
      });
    } catch (error) {
      // Do not leave a blob that no row points to.
      await this.storage.deletePrivate(storagePath, PARTNER_FILES_CONTAINER).catch(() => undefined);
      throw error;
    }
    if (saved.replacedPath) {
      await this.deleteQuietly([saved.replacedPath], `replaced file ${saved.id}`);
    }
    return toPartnerFile(
      await this.prisma.partnerFile.findFirstOrThrow({
        where: { id: saved.id, partnerSpaceId: spaceId },
        select: PARTNER_FILE_SELECT,
      }),
    );
  }

  /**
   * A 5-minute read-only link, written to the space's history (who looked at which file and
   * when). `inline` previews a PDF or an image; any other format is saved.
   */
  async link(
    spaceId: string,
    fileId: string,
    inline: boolean,
    user: AuthUser,
  ): Promise<PartnerFileLink> {
    const file = await this.prisma.partnerFile.findFirst({
      where: { id: fileId, partnerSpaceId: spaceId },
      select: {
        id: true,
        partnerApplicationId: true,
        storagePath: true,
        originalName: true,
        mimeType: true,
      },
    });
    if (!file) {
      throw fileNotFound();
    }
    const preview = inline && PREVIEWABLE.has(file.mimeType);
    const expiresAt = new Date(this.clock.now().getTime() + DOWNLOAD_LINK_TTL_SECONDS * 1000);
    const url = await this.storage.privateDownloadUrl(
      file.storagePath,
      { fileName: file.originalName, contentType: file.mimeType, inline: preview },
      PARTNER_FILES_CONTAINER,
    );
    await this.prisma.$transaction(async (tx) => {
      await this.history.record(tx, {
        spaceId,
        actor: actorOf(user),
        entityType: 'file',
        entityId: file.id,
        applicationId: file.partnerApplicationId,
        action: preview ? 'FILE_PREVIEWED' : 'FILE_DOWNLOADED',
      });
    });
    return { url, expiresAt: expiresAt.toISOString() };
  }

  // -------------------------------------------------------------------------
  // Logo (super admin, ADR-027 section 5)
  // -------------------------------------------------------------------------

  /** Checked from its bytes and re-encoded as WebP (like job covers), in the private container. */
  async setLogo(spaceId: string, content: Buffer, actor: PartnerActor): Promise<void> {
    const processed = await this.images.process(content, LOGO_MAX_WIDTH);
    const path = `${spacePrefix(spaceId)}logo-${randomUUID()}.webp`;
    await this.storage.uploadPrivate(
      path,
      processed.content,
      processed.contentType,
      PARTNER_FILES_CONTAINER,
    );
    let previous: string | null;
    try {
      previous = await this.replaceLogoPath(spaceId, path, actor, 'LOGO_UPDATED');
    } catch (error) {
      await this.storage.deletePrivate(path, PARTNER_FILES_CONTAINER).catch(() => undefined);
      throw error;
    }
    if (previous) {
      await this.deleteQuietly([previous], `previous logo of space ${spaceId}`);
    }
  }

  async removeLogo(spaceId: string, actor: PartnerActor): Promise<void> {
    const previous = await this.replaceLogoPath(spaceId, null, actor, 'LOGO_REMOVED');
    if (previous) {
      await this.deleteQuietly([previous], `logo of space ${spaceId}`);
    }
  }

  /** The logo for the members of a space: a 5-minute link the browser displays. */
  logoUrl(logoPath: string | null): Promise<string | null> {
    if (!logoPath) {
      return Promise.resolve(null);
    }
    return this.storage.privateDownloadUrl(
      logoPath,
      { fileName: 'logo.webp', contentType: 'image/webp', inline: true },
      PARTNER_FILES_CONTAINER,
    );
  }

  // -------------------------------------------------------------------------
  // Deletion (ADR-027, section 7, rules 7 and 11)
  // -------------------------------------------------------------------------

  /**
   * Deletes these blobs before their rows. Throws STORAGE_UNAVAILABLE when one cannot be
   * deleted, so the caller deletes no row: a retry finds the same rows and finishes the job.
   */
  async deleteBlobs(paths: string[]): Promise<void> {
    try {
      for (const path of paths) {
        await this.storage.deletePrivate(path, PARTNER_FILES_CONTAINER);
      }
    } catch (error) {
      this.logger.error(
        `Partner files not deleted: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw storageUnavailable();
    }
  }

  /** Deletes every blob of a space, then checks that none remains. */
  async deleteSpaceBlobs(spaceId: string): Promise<number> {
    let paths: string[];
    try {
      paths = await this.storage.listPrivate(spacePrefix(spaceId), PARTNER_FILES_CONTAINER);
    } catch (error) {
      this.logger.error(
        `Partner files not listed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw storageUnavailable();
    }
    await this.deleteBlobs(paths);
    const left = await this.storage
      .listPrivate(spacePrefix(spaceId), PARTNER_FILES_CONTAINER)
      .catch(() => null);
    if (left === null || left.length > 0) {
      throw storageUnavailable();
    }
    return paths.length;
  }

  /**
   * After the rows are gone: blobs written meanwhile (an upload that raced the deletion) are
   * deleted too. A failure is logged: nothing points to these blobs any more.
   */
  async deleteQuietly(paths: string[], what: string): Promise<void> {
    for (const path of paths) {
      try {
        await this.storage.deletePrivate(path, PARTNER_FILES_CONTAINER);
      } catch (error) {
        this.logger.warn(
          `Blob of ${what} not deleted: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    }
  }

  private async replaceLogoPath(
    spaceId: string,
    path: string | null,
    actor: PartnerActor,
    action: 'LOGO_UPDATED' | 'LOGO_REMOVED',
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const space = await tx.partnerSpace.findUnique({
        where: { id: spaceId },
        select: { logoPath: true },
      });
      if (!space) {
        throw notFound('Partner space not found');
      }
      if (space.logoPath === null && path === null) {
        return null;
      }
      await tx.partnerSpace.update({ where: { id: spaceId }, data: { logoPath: path } });
      await this.history.record(tx, {
        spaceId,
        actor,
        entityType: 'space',
        entityId: spaceId,
        action,
      });
      return space.logoPath;
    });
  }
}
