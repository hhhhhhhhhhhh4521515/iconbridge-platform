import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { isCacheTag } from '@/lib/cache-tags';

/**
 * Called by the API after a change in the back office (a job published, a story, a
 * slide, a setting): the named groups of cached data are dropped, so the next visitor
 * gets fresh content instead of waiting for the one-minute cache.
 *
 * Only a caller that knows REVALIDATE_SECRET is obeyed. Without the secret configured
 * the route answers 404, as if it did not exist.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REVALIDATE_SECRET ?? '';
  if (secret.length < 24) {
    return Response.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
  }
  const given = Buffer.from(request.headers.get('x-revalidate-secret') ?? '');
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = Array.isArray(body?.tags) ? body.tags.filter(isCacheTag) : [];
  for (const tag of tags) {
    // Expires now: the next request for this data goes to the API.
    revalidateTag(tag, { expire: 0 });
  }
  return Response.json({ revalidated: tags });
}
