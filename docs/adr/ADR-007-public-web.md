# ADR-007: Public web application

- Status: accepted
- Date: 2026-10-11

## Context

The public site must rank in search engines in three languages (one right-to-left), feel alive (slider, counters, carousels) on cheap phones, and share a session with the API through `SameSite=Lax` cookies. The API address differs between the workstation and Azure.

## Decision

| Topic                       | Choice                                                                         | Reason                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| API access from the browser | Same origin: `proxy.ts` forwards `/api/v1/*` to `API_INTERNAL_URL`             | First-party cookies, no CORS, and the API can stay internal in Azure                                                               |
| Proxy mechanism             | `NextResponse.rewrite` in `proxy.ts`, not `rewrites()` in `next.config.ts`     | `next.config.ts` rewrites are fixed at build time; the proxy reads the address at run time, so one image serves every environment  |
| Server data                 | Server components with `fetch` revalidation (60 s); `cacheComponents` disabled | Simple, well understood caching that works with next-intl; pages still render when the API is down                                 |
| Typed client                | `openapi-typescript` + `openapi-fetch`, generated into `packages/shared`       | Paths and bodies checked at compile time against the real API; no hand-written types                                               |
| Internationalisation        | next-intl, locale always in the path, French default                           | Each language has its own URL for search engines and `hreflang`                                                                    |
| Slider                      | Swiper for the hero only; scroll-snap rows for the other carousels             | Swiper where the brief needs autoplay, fade and swipe; native scrolling elsewhere costs no JavaScript and is accessible by default |
| Hero loading                | First slide rendered on the server; carousel code fetched after load           | The largest picture is visible without JavaScript; less work before the page is usable                                             |
| Animations                  | Motion for the hero texts; CSS for reveal, zoom, progress and counters         | The page reads fully without JavaScript and with reduced motion                                                                    |
| FAQ                         | Native `<details name>`                                                        | Accessible and exclusive without a script                                                                                          |
| Turnstile                   | Widget skipped with Cloudflare's test site key                                 | Local development and automated tests work offline; the API accepts the test secret outside production only                        |
| Metadata                    | Always in `<head>` (`htmlLimitedBots: /.*/`)                                   | Canonical, `hreflang` and descriptions are there for every crawler and audit tool                                                  |
| Closed jobs                 | Real 404 status                                                                | Search engines drop offers that are no longer open                                                                                 |
| Browser tests               | Playwright smoke tests on a desktop and a phone profile, against the real API  | They cover what unit tests cannot: slider behaviour, language direction, filters end to end                                        |

## Consequences

- `TRUST_PROXY_HOPS` on the API must include the web proxy, otherwise rate limits and audit entries see the web server's address.
- Uploads go through the proxy too (documents up to 5 MB). The proxy buffers request bodies up to 10 MB by default.
- The home page is rebuilt at most once a minute: a new slide or story can take a minute to appear.
- The generated client must be refreshed (`pnpm api:types`) when an endpoint changes; a stale file shows up as a type error in the web app.
- Login, registration and the candidate area are placeholders. "Login to apply" and "Apply now" lead to them.
- Legal pages are general models and say so; they need a legal review.
- Open Graph images use Latin text only (the built-in font has no Arabic glyphs).
- Social links in the footer point to the networks' home pages until the real addresses are known.
- Lighthouse on this workstation (no GPU, software rendering) varies between runs; see the journal for the measured values and the method.
