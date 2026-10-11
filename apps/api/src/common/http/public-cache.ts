/**
 * Cache-Control of the public read endpoints (jobs, catalog, stories, slides, site
 * info): the same answer for everybody, kept one minute by browsers and proxies and
 * served a little longer while a fresh one is fetched. The web app drops its own
 * copy at once when the back office changes something (see SiteCacheService).
 */
export const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=120';
