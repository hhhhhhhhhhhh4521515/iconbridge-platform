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
  // Sent with every response. The Content Security Policy is not here: it carries a
  // nonce that changes with each page, so `src/proxy.ts` writes it.
  headers: () =>
    Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          // Browsers ignore it over plain http, so it is harmless on localhost.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ]),
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
