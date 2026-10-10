import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import {
  DOCUMENT_FORMATS,
  DOCUMENT_MIME_TYPES,
  type DocumentFormat,
  type DocumentType,
} from '@iconbridge/shared';
import { fileTypeFromBuffer } from 'file-type';
import { AppException } from '../common/errors/app.exception.js';

export interface InspectedFile {
  format: DocumentFormat;
  mimeType: string;
  sha256: string;
}

const FORMAT_BY_MIME = new Map<string, DocumentFormat>(
  (Object.entries(DOCUMENT_MIME_TYPES) as [DocumentFormat, string][]).map(([format, mime]) => [
    mime,
    format,
  ]),
);

/**
 * Identifies an upload from its first bytes ("magic bytes"), never from its
 * name or the type the browser declared, and checks that this format is
 * accepted for the document type. A renamed executable is refused here.
 */
export async function inspectDocument(content: Buffer, type: DocumentType): Promise<InspectedFile> {
  const detected = await fileTypeFromBuffer(content);
  const format = detected ? FORMAT_BY_MIME.get(detected.mime) : undefined;
  const accepted = DOCUMENT_FORMATS[type];
  if (!format || !accepted.includes(format)) {
    throw new AppException(
      'UNSUPPORTED_FILE',
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'The content of this file is not an accepted format',
      { documentType: type, accepted },
    );
  }
  return {
    format,
    mimeType: DOCUMENT_MIME_TYPES[format],
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

const MAX_NAME_LENGTH = 200;

/**
 * Name shown to users and proposed when downloading. Folders and control
 * characters are removed; the name is never used as a path in storage.
 */
export function sanitizeFileName(name: string | undefined, format: DocumentFormat): string {
  const base = (name ?? '')
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return base && base !== '.' && base !== '..' ? base : `document.${format}`;
}

/** multer decodes multipart file names as latin1; they are UTF-8 in practice. */
export function decodeUploadName(name: string | undefined): string | undefined {
  return name === undefined ? undefined : Buffer.from(name, 'latin1').toString('utf8');
}
