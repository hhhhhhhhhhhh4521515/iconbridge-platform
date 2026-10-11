import {
  DOCUMENT_FORMATS,
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENTS_PER_CANDIDATE,
  type DocumentFormat,
} from '@iconbridge/shared/candidate';
import type { DocumentType } from '@iconbridge/shared/enums';

export type Refusal = 'empty' | 'tooLarge' | 'wrongType' | 'tooMany';

function formatOf(file: File): DocumentFormat | null {
  const extension = file.name.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg') ?? '';
  if (!(extension in DOCUMENT_MIME_TYPES)) {
    return null;
  }
  const format = extension as DocumentFormat;
  // Some systems give no type for a file; when there is one it must agree with the extension.
  return !file.type || file.type === DOCUMENT_MIME_TYPES[format] ? format : null;
}

/** The checks made before anything is sent. The API makes them again on the content. */
export function refusal(
  file: File,
  type: DocumentType,
  maxMb: number,
  count: number,
): Refusal | null {
  if (count >= MAX_DOCUMENTS_PER_CANDIDATE) return 'tooMany';
  if (file.size === 0) return 'empty';
  if (file.size > maxMb * 1024 * 1024) return 'tooLarge';
  const format = formatOf(file);
  return format && DOCUMENT_FORMATS[type].includes(format) ? null : 'wrongType';
}
