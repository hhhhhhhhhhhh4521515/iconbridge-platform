/** Names shared with the API (SITE_CACHE_TAGS in apps/api/src/site-cache/site-cache.service.ts). */
export const CACHE_TAGS = ['jobs', 'catalog', 'stories', 'slides', 'site-info', 'stats'] as const;
export type CacheTag = (typeof CACHE_TAGS)[number];

export function isCacheTag(value: unknown): value is CacheTag {
  return typeof value === 'string' && (CACHE_TAGS as readonly string[]).includes(value);
}

/** The groups an answer of the API belongs to, from the path that was asked. */
export function tagsFor(pathname: string): CacheTag[] {
  const path = pathname.replace(/^\/api\/v1/, '');
  if (path.startsWith('/jobs')) return ['jobs'];
  // Destinations and categories carry the number of open jobs.
  if (path.startsWith('/destinations') || path.startsWith('/categories'))
    return ['catalog', 'jobs'];
  if (path.startsWith('/success-stories')) return ['stories'];
  if (path.startsWith('/home-slides')) return ['slides'];
  if (path.startsWith('/site-info')) return ['site-info'];
  if (path.startsWith('/stats')) return ['stats'];
  return [];
}
