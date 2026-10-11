import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import {
  DOCUMENT_FORMATS,
  DOCUMENT_MIME_TYPES,
  type DocumentFormat,
  type DocumentType,
} from '@iconbridge/shared';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { AppException } from '../common/errors/app.exception.js';

export interface InspectedFile {
  format: DocumentFormat;
  mimeType: string;
  /** What is stored: the upload itself, or the image re-encoded without its metadata. */
  content: Buffer;
  /** SHA-256 of `content`. */
  sha256: string;
}

/** Decoded size limit of an image, against decompression bombs. */
const MAX_PIXELS = 50_000_000;

/**
 * Phone photos and scans carry metadata: GPS position, device, date, sometimes a
 * thumbnail of the uncropped picture. A JPEG or PNG is decoded and encoded again:
 * the pixels are kept (turned upright first, since the orientation tag goes too) and
 * every metadata block is dropped. A file that cannot be decoded is refused.
 */
export async function stripImageMetadata(content: Buffer, format: DocumentFormat): Promise<Buffer> {
  if (format !== 'jpg' && format !== 'png') {
    return content;
  }
  try {
    const image = sharp(content, { failOn: 'error', limitInputPixels: MAX_PIXELS }).rotate();
    return await (format === 'jpg' ? image.jpeg({ quality: 92 }) : image.png()).toBuffer();
  } catch {
    throw new AppException(
      'UNSUPPORTED_FILE',
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'This image cannot be read',
    );
  }
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
 * accepted for the document type. A renamed executable is refused here. Images are
 * returned without their metadata (see stripImageMetadata).
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
  const stored = await stripImageMetadata(content, format);
  return {
    format,
    mimeType: DOCUMENT_MIME_TYPES[format],
    content: stored,
    sha256: createHash('sha256').update(stored).digest('hex'),
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
