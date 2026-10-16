import type { Readable } from 'node:stream';
import type {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  UserDelegationKey,
} from '@azure/storage-blob';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lazy } from '../common/lazy.js';
import type { Env } from '../config/env.js';
import {
  CANDIDATE_DOCUMENTS_CONTAINER,
  DOWNLOAD_LINK_TTL_SECONDS,
  PUBLIC_MEDIA_CONTAINER,
  StorageService,
  type DownloadLinkOptions,
} from './storage.service.js';

/** Links are dated slightly in the past so a small clock difference with Azure does not reject them. */
const CLOCK_SKEW_MS = 60 * 1000;
const DELEGATION_KEY_TTL_MS = 60 * 60 * 1000;
/** A cached delegation key is renewed when less than this remains. */
const DELEGATION_KEY_MARGIN_MS = 10 * 60 * 1000;

/** RFC 6266 header value; the ASCII fallback has no quote, backslash or control character. */
export function contentDisposition(fileName: string, inline = false): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Azure Blob Storage. Two ways to authenticate, chosen by configuration:
 *
 * - AZURE_STORAGE_CONNECTION_STRING: Azurite, or an account key. Download links
 *   are service SAS signed with the account key.
 * - AZURE_STORAGE_ACCOUNT_URL: managed identity through DefaultAzureCredential.
 *   No key exists anywhere; download links are user-delegation SAS signed with a
 *   key Azure issues to the identity for one hour.
 */
@Injectable()
export class AzureStorageService extends StorageService {
  private readonly logger = new Logger(AzureStorageService.name);
  /**
   * The Azure SDK (about a second of start-up on 0.5 vCPU) is loaded with the first file
   * operation: public addresses, which most requests need, are plain text.
   */
  private readonly clients: () => Promise<Clients>;
  private readonly publicBaseUrl: string;
  private readonly ready = new Map<string, Promise<void>>();
  private delegationKey: { key: UserDelegationKey; expiresAt: number } | undefined;

  constructor(config: ConfigService<Env, true>) {
    super();
    const connectionString = config.get('AZURE_STORAGE_CONNECTION_STRING', { infer: true });
    const accountUrl = config.get('AZURE_STORAGE_ACCOUNT_URL', { infer: true });
    this.publicBaseUrl = config.get('PUBLIC_MEDIA_BASE_URL', { infer: true });
    this.clients = lazy(async () => {
      const sdk = await import('@azure/storage-blob');
      let service: BlobServiceClient;
      let sharedKey: StorageSharedKeyCredential | null = null;
      if (connectionString) {
        service = sdk.BlobServiceClient.fromConnectionString(connectionString);
        const credential = service.credential;
        sharedKey = credential instanceof sdk.StorageSharedKeyCredential ? credential : null;
      } else {
        const { DefaultAzureCredential } = await import('@azure/identity');
        service = new sdk.BlobServiceClient(accountUrl, new DefaultAzureCredential());
      }
      return {
        sdk,
        service,
        sharedKey,
        publicMedia: service.getContainerClient(PUBLIC_MEDIA_CONTAINER),
        documents: service.getContainerClient(CANDIDATE_DOCUMENTS_CONTAINER),
      };
    });
  }

  publicUrl(path: string | null): string | null {
    return path
      ? `${this.publicBaseUrl}/${path.split('/').map(encodeURIComponent).join('/')}`
      : null;
  }

  /** Paths contain a content hash, so public files are cached for a year. */
  async uploadPublic(path: string, content: Buffer, contentType: string): Promise<void> {
    const { publicMedia } = await this.clients();
    await this.ensureContainer(publicMedia, 'blob');
    await publicMedia.getBlockBlobClient(path).uploadData(content, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        blobCacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  async deletePublic(path: string): Promise<void> {
    try {
      const { publicMedia } = await this.clients();
      await publicMedia.getBlockBlobClient(path).deleteIfExists();
    } catch (error) {
      this.logger.warn(
        `Public file not deleted: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  async uploadPrivate(path: string, content: Buffer, contentType: string): Promise<void> {
    const { documents } = await this.clients();
    await this.ensureContainer(documents, undefined);
    await documents.getBlockBlobClient(path).uploadData(content, {
      blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'private, no-store' },
    });
  }

  async deletePrivate(path: string): Promise<void> {
    const { documents } = await this.clients();
    await documents.getBlockBlobClient(path).deleteIfExists();
  }

  async readPrivate(path: string): Promise<Readable> {
    const { documents } = await this.clients();
    const response = await documents.getBlockBlobClient(path).download();
    if (!response.readableStreamBody) {
      throw new Error('The storage returned no content');
    }
    return response.readableStreamBody as Readable;
  }

  async privateDownloadUrl(path: string, options: DownloadLinkOptions): Promise<string> {
    const now = Date.now();
    const { sdk, service, sharedKey, documents } = await this.clients();
    const { BlobSASPermissions, SASProtocol, generateBlobSASQueryParameters } = sdk;
    const blob = documents.getBlockBlobClient(path);
    const values = {
      containerName: CANDIDATE_DOCUMENTS_CONTAINER,
      blobName: path,
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(now - CLOCK_SKEW_MS),
      expiresOn: new Date(now + (options.expiresInSeconds ?? DOWNLOAD_LINK_TTL_SECONDS) * 1000),
      // HTTPS only, except for the local emulator which speaks plain HTTP.
      protocol: blob.url.startsWith('https:') ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
      contentDisposition: contentDisposition(options.fileName, options.inline),
      contentType: options.contentType,
      cacheControl: 'private, no-store',
    };
    const signature = sharedKey
      ? generateBlobSASQueryParameters(values, sharedKey)
      : generateBlobSASQueryParameters(
          values,
          await this.userDelegationKey(service, now),
          service.accountName,
        );
    return `${blob.url}?${signature.toString()}`;
  }

  private async userDelegationKey(
    service: BlobServiceClient,
    now: number,
  ): Promise<UserDelegationKey> {
    if (!this.delegationKey || this.delegationKey.expiresAt - now < DELEGATION_KEY_MARGIN_MS) {
      const expiresAt = now + DELEGATION_KEY_TTL_MS;
      this.delegationKey = {
        key: await service.getUserDelegationKey(new Date(now - CLOCK_SKEW_MS), new Date(expiresAt)),
        expiresAt,
      };
    }
    return this.delegationKey.key;
  }

  /** Creates the container on first use. `access` undefined means private. */
  private ensureContainer(container: ContainerClient, access: 'blob' | undefined): Promise<void> {
    let ready = this.ready.get(container.containerName);
    if (!ready) {
      ready = container
        .createIfNotExists(access ? { access } : {})
        .then(() => undefined)
        .catch((error: unknown) => {
          this.ready.delete(container.containerName);
          throw error;
        });
      this.ready.set(container.containerName, ready);
    }
    return ready;
  }
}

interface Clients {
  sdk: typeof import('@azure/storage-blob');
  service: BlobServiceClient;
  sharedKey: StorageSharedKeyCredential | null;
  publicMedia: ContainerClient;
  documents: ContainerClient;
}
