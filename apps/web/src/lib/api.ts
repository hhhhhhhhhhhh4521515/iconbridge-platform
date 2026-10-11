import 'server-only';
import { createApiClient, type ApiPaths } from '@iconbridge/shared/api-client';
import { env } from './env';

/** Public data is cached by Next.js and refreshed at most once a minute. */
const REVALIDATE_SECONDS = 60;

const cached = createApiClient({
  baseUrl: env.API_INTERNAL_URL,
  fetch: (request) => fetch(request, { next: { revalidate: REVALIDATE_SECONDS } }),
});

type Json<Path extends keyof ApiPaths> = ApiPaths[Path] extends {
  get: { responses: { 200: { content: { 'application/json': infer Body } } } };
}
  ? Body
  : never;

export type PublicJob = Json<'/api/v1/jobs/{slug}'>;
export type JobPage = Json<'/api/v1/jobs'>;
export type Destination = Json<'/api/v1/destinations'>[number];
export type Category = Json<'/api/v1/categories'>[number];
export type PublicStats = Json<'/api/v1/stats'>;
export type HomeSlide = Json<'/api/v1/home-slides'>[number];
export type SuccessStory = Json<'/api/v1/success-stories'>[number];
export type SiteInfo = Json<'/api/v1/site-info'>;

export interface JobQuery {
  q?: string;
  destination?: string;
  category?: string;
  language?: string;
  salaryMin?: number;
  currency?: string;
  featured?: 'true' | 'false';
  sort?: 'relevance' | 'newest' | 'deadline' | 'salary';
  page?: number;
  pageSize?: number;
}

/**
 * Server components must render even when the API is unreachable (build without a
 * backend, short outage): a failed call gives the fallback and is logged.
 */
async function safely<T>(
  what: string,
  fallback: T,
  call: () => Promise<T | undefined>,
): Promise<T> {
  try {
    return (await call()) ?? fallback;
  } catch (error) {
    console.error(
      `API call failed: ${what} (${error instanceof Error ? error.name : 'unknown error'})`,
    );
    return fallback;
  }
}

const EMPTY_PAGE: JobPage = { items: [], page: 1, pageSize: 20, total: 0 };

export const api = {
  jobs: (query: JobQuery = {}) =>
    safely(
      'jobs',
      EMPTY_PAGE,
      async () => (await cached.GET('/api/v1/jobs', { params: { query } })).data,
    ),

  /** Null when the job does not exist or is no longer open (the API answers 404). */
  job: (slug: string) =>
    safely<PublicJob | null>('job', null, async () => {
      const { data } = await cached.GET('/api/v1/jobs/{slug}', { params: { path: { slug } } });
      return data ?? null;
    }),

  destinations: () =>
    safely('destinations', [], async () => (await cached.GET('/api/v1/destinations')).data),
  categories: () =>
    safely('categories', [], async () => (await cached.GET('/api/v1/categories')).data),
  stats: () =>
    safely<PublicStats | null>(
      'stats',
      null,
      async () => (await cached.GET('/api/v1/stats')).data ?? null,
    ),
  homeSlides: () =>
    safely('home slides', [], async () => (await cached.GET('/api/v1/home-slides')).data),
  successStories: () =>
    safely('success stories', [], async () => (await cached.GET('/api/v1/success-stories')).data),
  siteInfo: () =>
    safely<SiteInfo | null>(
      'site info',
      null,
      async () => (await cached.GET('/api/v1/site-info')).data ?? null,
    ),

  /** Every open job, page after page, for the sitemap. */
  allJobs: async (): Promise<PublicJob[]> => {
    const all: PublicJob[] = [];
    for (let page = 1; page <= 50; page++) {
      const result = await api.jobs({ page, pageSize: 100, sort: 'newest' });
      all.push(...result.items);
      if (all.length >= result.total || result.items.length === 0) {
        break;
      }
    }
    return all;
  },
};
