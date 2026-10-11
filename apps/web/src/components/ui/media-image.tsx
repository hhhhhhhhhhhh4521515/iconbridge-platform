import Image, { type ImageProps } from 'next/image';

/**
 * next/image for pictures that may come from blob storage. The image optimiser
 * only fetches from the hosts allowed in next.config.ts (https blob storage), so
 * pictures served by the local emulator (http://localhost:10000) are shown as they
 * are; they are already WebP files resized by the API.
 */
export function MediaImage({ src, alt, ...props }: ImageProps) {
  const direct =
    typeof src === 'string' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(src);
  return <Image src={src} alt={alt} unoptimized={direct} {...props} />;
}
