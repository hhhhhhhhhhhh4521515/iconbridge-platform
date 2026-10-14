import { z } from 'zod';

/**
 * In a browser, zod is told not to compile its checks. To find out whether it may,
 * zod calls `Function("")` when an object schema is created; the Content-Security-Policy
 * of the site refuses that, as it should, and the browser reports a violation on every
 * page with a form. The API keeps the compiled checks, which are faster.
 *
 * Every module of this package that creates schemas imports this file first.
 */
if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
  z.config({ jitless: true });
}
