import { describe, expect, it } from 'vitest';
import { isCacheTag, tagsFor } from './cache-tags';

describe('cache tags', () => {
  it.each([
    ['/api/v1/jobs', ['jobs']],
    ['/api/v1/jobs/welder-malta', ['jobs']],
    ['/api/v1/destinations', ['catalog', 'jobs']],
    ['/api/v1/categories', ['catalog', 'jobs']],
    ['/api/v1/success-stories', ['stories']],
    ['/api/v1/home-slides', ['slides']],
    ['/api/v1/site-info', ['site-info']],
    ['/api/v1/stats', ['stats']],
    ['/api/v1/me/profile', []],
  ])('%s belongs to %j', (path, tags) => {
    expect(tagsFor(path)).toEqual(tags);
  });

  it('accepts only the known names', () => {
    expect(isCacheTag('jobs')).toBe(true);
    expect(isCacheTag('everything')).toBe(false);
    expect(isCacheTag(42)).toBe(false);
  });
});
