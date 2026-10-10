import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/** Container readable by anyone: job covers, slides, story photos. Never candidate documents. */
export const PUBLIC_MEDIA_CONTAINER = 'public-media';

/** Azure Blob Storage (Azurite locally). */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly publicMedia: ContainerClient;
  private readonly publicBaseUrl: string;
  private ready: Promise<void> | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.publicMedia = BlobServiceClient.fromConnectionString(
      config.get('AZURE_STORAGE_CONNECTION_STRING', { infer: true }),
    ).getContainerClient(PUBLIC_MEDIA_CONTAINER);
    this.publicBaseUrl = config.get('PUBLIC_MEDIA_BASE_URL', { infer: true });
  }

  /** Absolute URL of a file of the public container; null for no file. */
  publicUrl(path: string | null): string | null {
    return path
      ? `${this.publicBaseUrl}/${path.split('/').map(encodeURIComponent).join('/')}`
      : null;
  }

  /** Stores a public file. Paths contain a content hash, so files are cached for a year. */
  async uploadPublic(path: string, content: Buffer, contentType: string): Promise<void> {
    await this.ensurePublicContainer();
    await this.publicMedia.getBlockBlobClient(path).uploadData(content, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        blobCacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  /** Removes a public file. A missing file is not an error; a failure is logged, not thrown. */
  async deletePublic(path: string): Promise<void> {
    try {
      await this.publicMedia.getBlockBlobClient(path).deleteIfExists();
    } catch (error) {
      this.logger.warn(
        `Public file not deleted: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  /** Creates the container on first use, readable anonymously blob by blob (no listing). */
  private ensurePublicContainer(): Promise<void> {
    this.ready ??= this.publicMedia
      .createIfNotExists({ access: 'blob' })
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }
}
