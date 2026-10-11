import type { Readable } from 'node:stream';

/** Container readable by anyone: job covers, slides, story photos. Never candidate documents. */
export const PUBLIC_MEDIA_CONTAINER = 'public-media';
/** Private container: passports, CVs, certificates. Read only through short-lived signed links. */
export const CANDIDATE_DOCUMENTS_CONTAINER = 'candidate-documents';

export const DOWNLOAD_LINK_TTL_SECONDS = 5 * 60;

export interface DownloadLinkOptions {
  /** Name proposed by the browser when saving the file. */
  fileName: string;
  contentType: string;
  /** Defaults to 5 minutes. */
  expiresInSeconds?: number;
  /** True: the browser displays the file (preview). False or absent: it saves it. */
  inline?: boolean;
}

/**
 * File storage, as the rest of the API sees it. The Azure implementation
 * (azure-storage.service.ts) works with Azurite, an account key or a managed
 * identity; tests replace it with an in-memory one. Nothing outside the
 * implementation ever sees a storage key.
 */
export abstract class StorageService {
  /** Absolute URL of a file of the public container; null for no file. */
  abstract publicUrl(path: string | null): string | null;
  abstract uploadPublic(path: string, content: Buffer, contentType: string): Promise<void>;
  /** A missing file is not an error; a failure is logged, not thrown. */
  abstract deletePublic(path: string): Promise<void>;

  abstract uploadPrivate(path: string, content: Buffer, contentType: string): Promise<void>;
  /** A missing file is not an error. Throws when the storage cannot be reached. */
  abstract deletePrivate(path: string): Promise<void>;
  /** Content of a private file, for the server only (GDPR export). */
  abstract readPrivate(path: string): Promise<Readable>;
  /** Read-only link to one private file, valid for a few minutes. */
  abstract privateDownloadUrl(path: string, options: DownloadLinkOptions): Promise<string>;
}
