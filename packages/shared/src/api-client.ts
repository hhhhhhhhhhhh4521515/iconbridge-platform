import createClient, { type Client, type ClientOptions } from 'openapi-fetch';
import type { paths } from './generated/api.js';

export type ApiPaths = paths;
export type ApiClient = Client<paths>;

/**
 * Typed HTTP client of the API. Paths, parameters and response bodies come from
 * `generated/api.ts`, which is generated from the API's OpenAPI document with
 * `pnpm api:types`; run it again whenever an endpoint changes.
 *
 * Browser code imports it from `@iconbridge/shared/api-client`, not from the package
 * root, so the zod schemas of the other modules stay out of the page bundle.
 *
 * - In the browser: `createApiClient()`. Calls go to `/api/v1/...` on the web
 *   origin (the web app proxies them), so the session cookies are sent.
 * - On the server: `createApiClient({ baseUrl: API_INTERNAL_URL })`.
 */
export function createApiClient(options: ClientOptions = {}): ApiClient {
  return createClient<paths>({ credentials: 'same-origin', ...options });
}
