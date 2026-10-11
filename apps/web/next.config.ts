import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Public images uploaded through the back office live in blob storage. Local
  // emulator URLs are not optimised (see components/ui/media-image.tsx).
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '*.blob.core.windows.net' }],
  },
  poweredByHeader: false,
  // Titles, descriptions, canonical and hreflang links always go in <head>, for every
  // visitor and crawler, instead of being streamed into the body after the first bytes.
  htmlLimitedBots: /.*/,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default withNextIntl(nextConfig);
