# ADR-008: Candidate area of the web application

- Status: accepted
- Date: 2026-10-11

## Context

Candidates register, complete a profile in several steps, upload documents, apply and follow their applications. The session lives in two httpOnly cookies set by the API: an access token valid 15 minutes (path `/`) and a refresh token valid 7 days, sent only to `/api/v1/auth`. The web server therefore never sees the refresh token, and it cannot renew a session by itself while rendering a page. The pages hold personal data and must not be cached or indexed.

## Decision

| Topic                   | Choice                                                                                                                                        | Reason                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where data is fetched   | In the browser, through `/api/v1/*`; the pages under `/account` render a shell on the server and no personal data                             | The browser holds both cookies, so it can renew the session; nothing personal can end up in a server cache                                        |
| Protecting `/account/*` | `proxy.ts` redirects to `/login?next=...` when the `ib_session` cookie is absent                                                              | The visitor never sees an empty account page. It is a convenience: the API decides every access from the real tokens                              |
| `ib_session` cookie     | Set and cleared by the API with the session cookies; value `1`, readable by scripts, same lifetime as the refresh token                       | The refresh cookie is not sent to page requests, and the access cookie expires after 15 minutes: neither can tell the proxy that a session exists |
| Silent refresh          | One wrapper around `fetch` (`lib/client-api.ts`): on 401, `POST /auth/refresh` once (shared by concurrent calls), then the call is sent again | The person never sees the 15-minute expiry. If the refresh fails, the marker is removed and the login page opens with `next`                      |
| Forms                   | react-hook-form with a small resolver over the zod schemas of `packages/shared`                                                               | The browser and the API validate with the same schema. The resolver returns message keys, so errors are shown in the page language                |
| Profile wizard          | One form per step; each step validates and saves the whole profile (`PUT /me/profile`) with the other steps unchanged                         | The API contract stays "replace the profile"; rules that span steps (passport dates) are checked on every save                                    |
| Country lists           | Native `<select>` with flag emoji; a 78 kB font limited to the flag code points makes them visible on Windows                                 | Native lists work with a keyboard, a screen reader, a phone and right-to-left without extra code                                                  |
| Dates                   | Native `<input type="date">`                                                                                                                  | The browser shows the picker in the visitor's language and direction, and always submits `YYYY-MM-DD`                                             |
| Phone numbers           | Country list with calling code plus the national number (libphonenumber-js, `min` metadata); the form receives one E.164 number               | Candidates do not know the international format; the API stores E.164                                                                             |
| Upload                  | `XMLHttpRequest`, one file at a time, with size and format checked before sending                                                             | `fetch` cannot report upload progress. The API checks the content again                                                                           |
| Previews                | `GET /documents/:id/download?inline=true`: the signed link is issued with an inline content disposition                                       | The same short-lived link mechanism as downloads; without the option the browser saves the file                                                   |
| Password strength       | zxcvbn-ts, loaded when a password field is first used                                                                                         | The same library and threshold as the API, without its weight on the first load                                                                   |
| Destination preferences | `preferredDestinations` on the profile                                                                                                        | Drives the recommended jobs and whether the cruise-ship step is shown                                                                             |
| Questions when applying | Two general questions stored in `answers`, keyed by an English label                                                                          | Jobs have no question list yet; recruiters read the key as it is                                                                                  |
| Server-rendered forms   | Fields are disabled until the page's scripts run                                                                                              | Text typed before that moment was lost when the form took over (found by the browser test)                                                        |

## Consequences

- The candidate area needs JavaScript. The public site still reads without it.
- A stale `ib_session` cookie (session ended on the server) lets the account shell load; the first API call fails, the refresh fails, and the browser goes to the login page.
- `GET /auth/session` and `GET /auth/me` use the general rate limit (120 per minute per address) instead of the limit of the password endpoints: every job page calls the first one.
- Emails about applications now link to `/<locale>/account/applications`.
- `GET /site-info` also returns `MAX_UPLOAD_SIZE_MB`, so the browser can refuse a file that is too large before sending it.
- The flag font (Twemoji Country Flags, graphics under CC-BY 4.0) is served from `public/fonts`.
- Per-job questions need a field on the job and a screen in the back office; until then the two general questions are asked for every job.
