import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception.js';

export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_MAX_WIDTH = 1200;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
/** Refuses decompression bombs: about 50 megapixels. */
const MAX_PIXELS = 50_000_000;

export interface ProcessedCover {
  content: Buffer;
  contentType: 'image/webp';
  /** File name including a hash of the content, e.g. "cover-3f9a1c2b4d5e6f70.webp". */
  fileName: string;
  width: number;
  height: number;
}

const unsupported = (message: string) =>
  new AppException('UNSUPPORTED_FILE', HttpStatus.UNSUPPORTED_MEDIA_TYPE, message);

/**
 * Turns an uploaded image (job cover, story photo, home slide) into the stored file: the format is read from the
 * bytes (not from the file name or the declared type), the image is rotated as
 * its EXIF says, limited to 1200 px wide and re-encoded as WebP. Re-encoding
 * also drops EXIF data such as GPS coordinates.
 */
@Injectable()
export class JobCoverService {
  async process(file: Buffer, maxWidth: number = COVER_MAX_WIDTH): Promise<ProcessedCover> {
    if (file.length === 0 || file.length > COVER_MAX_BYTES) {
      throw unsupported('The image must be between 1 byte and 5 MB');
    }
    // Loaded with the first image, not when the API starts.
    const { default: sharp } = await import('sharp');
    try {
      const image = sharp(file, { failOn: 'error', limitInputPixels: MAX_PIXELS });
      const { format } = await image.metadata();
      if (!ACCEPTED_FORMATS.has(format)) {
        throw unsupported('Only JPEG, PNG and WebP images are accepted');
      }
      const { data, info } = await image
        .rotate()
        .resize({ width: maxWidth, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
      return {
        content: data,
        contentType: 'image/webp',
        fileName: `cover-${hash}.webp`,
        width: info.width,
        height: info.height,
      };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      throw unsupported('The file is not a readable image');
    }
  }
}
