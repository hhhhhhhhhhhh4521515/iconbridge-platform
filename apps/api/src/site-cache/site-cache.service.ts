import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogService } from '../catalog/catalog.service.js';
import type { Env } from '../config/env.js';

/** Groups of cached data of the public site; the web app tags its requests with them. */
export const SITE_CACHE_TAGS = [
  'jobs',
  'catalog',
  'stories',
  'slides',
  'site-info',
  'stats',
] as const;
export type SiteCacheTag = (typeof SITE_CACHE_TAGS)[number];

const TIMEOUT_MS = 3000;
/**
 * The web app is told a second time this long after the change: a page that was being
 * rendered with the old data when the first notice arrived would otherwise keep it for
 * a minute.
 */
export const REPEAT_NOTICE_MS = 3000;

/**
 * Tells the public site that something it shows has changed. The web app keeps the
 * answers of the API for a minute; after a change in the back office it is asked to
 * drop the groups concerned, so the next visitor sees the new content at once.
 *
 * Best effort and never awaited by a request: if the web app cannot be reached, the
 * change still appears when its one-minute cache ends.
 */
@Injectable()
export class SiteCacheService {
  private readonly logger = new Logger(SiteCacheService.name);
  private readonly url: string | null;
  private readonly secret: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly catalog: CatalogService,
  ) {
    this.secret = config.get('REVALIDATE_SECRET', { infer: true });
    const base =
      config.get('WEB_INTERNAL_URL', { infer: true }) || config.get('WEB_ORIGIN', { infer: true });
    this.url = this.secret ? new URL('/api/revalidate', base).toString() : null;
  }

  invalidate(tags: readonly SiteCacheTag[]): void {
    if (tags.includes('stats')) {
      // The counters are also kept in memory by this API instance.
      this.catalog.clearStatsCache();
    }
    if (!this.url || tags.length === 0) {
      return;
    }
    const url = this.url;
    void this.notify(url, tags);
    setTimeout(() => void this.notify(url, tags), REPEAT_NOTICE_MS).unref();
  }

  private async notify(url: string, tags: readonly SiteCacheTag[]): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': this.secret },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`The web app refused the cache refresh (${response.status})`);
      }
    } catch (error) {
      this.logger.warn(
        `The web app could not be told to refresh its cache: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }
}
