import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/routing';
import { api } from '@/lib/api';
import { localizedUrl } from '@/lib/seo';

/** Rebuilt at most every 10 minutes: new jobs appear, closed ones disappear. */
export const revalidate = 600;

const STATIC_PATHS = ['', '/jobs', '/success-stories', '/about', '/contact', '/privacy', '/terms'];

/** One entry per page with its three language versions, for the static pages and every open job. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entry = (path: string, extra: Partial<MetadataRoute.Sitemap[number]> = {}) => ({
    url: localizedUrl(DEFAULT_LOCALE, path),
    alternates: {
      languages: Object.fromEntries(LOCALES.map((locale) => [locale, localizedUrl(locale, path)])),
    },
    ...extra,
  });
  const jobs = await api.allJobs();
  return [
    ...STATIC_PATHS.map((path) =>
      entry(path, {
        changeFrequency: path === '' || path === '/jobs' ? 'daily' : 'monthly',
        priority: path === '' ? 1 : 0.6,
      }),
    ),
    ...jobs.map((job) =>
      entry(`/jobs/${job.slug}`, {
        lastModified: job.publishedAt ? new Date(job.publishedAt) : undefined,
        changeFrequency: 'weekly',
        priority: 0.8,
      }),
    ),
  ];
}
