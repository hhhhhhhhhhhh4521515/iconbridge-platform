# Security

What protects IconBridge Jobs, how each protection is checked, and what is still a risk. Written after the security and QA audit of October 2026 ([QA-REPORT.md](QA-REPORT.md) has the results of the test runs).

The platform holds identity documents: passport numbers, passport scans, dates of birth, phone numbers. The rule behind most choices below is that a mistake in one place (a forgotten guard, a careless log line, a wrong export option) must not be enough to expose them.

## Reporting a problem

Write to the address in the "Contact email" setting of the back office, with "Security" in the subject. Do not open a public issue for a vulnerability.

## OWASP Top 10 checklist

Status: **OK** means the control exists and a test fails if it is removed. **Risk** means something is left to do or to accept; each one is listed again under [Remaining risks](#remaining-risks).

| #   | Category                                 | Status | Controls                                                                                                                                                                                                                  | Checked by                                                                                              |
| --- | ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A01 | Broken access control                    | OK     | Every route needs a session unless `@Public()`; back-office routes need `@Roles`; candidate records go through `OwnershipGuard`; CSRF origin check                                                                        | `security.e2e-spec.ts` (every route), `rbac.e2e-spec.ts`, browser tests of the viewer and the recruiter |
| A02 | Cryptographic failures                   | OK     | Passport numbers encrypted with AES-256-GCM; passwords argon2id; tokens stored as SHA-256; cookies `Secure`; HSTS                                                                                                         | `field-cipher.spec.ts`, `passport.spec.ts`, `password.spec.ts`, `security.e2e-spec.ts`                  |
| A03 | Injection                                | OK     | Prisma everywhere; raw SQL only as tagged templates with bound parameters; rich text cleaned with DOMPurify on the server; spreadsheet formulas neutralised                                                               | `rich-text.spec.ts`, search and export e2e tests, eslint-plugin-security                                |
| A04 | Insecure design                          | OK     | Business rules in the API, not the UI; one function decides who may apply; state machine for statuses; deletions need a reason and are audited                                                                            | `rules.spec.ts` (every transition and rule), `applications.e2e-spec.ts`                                 |
| A05 | Security misconfiguration                | OK     | Environment validated at start; test conveniences refused in production; security headers; CSP with nonces; no stack trace in answers                                                                                     | `env.spec.ts`, `security.e2e-spec.ts`, `csp.test.ts`, CSP watched in every accessibility browser test   |
| A06 | Vulnerable and outdated components       | Risk   | `pnpm audit`, trivy; production dependencies have no known vulnerability. One advisory without a fix remains in lint tooling                                                                                              | [Dependencies](#dependencies)                                                                           |
| A07 | Identification and authentication errors | OK     | Rate limits on sign-in; no account enumeration; refresh tokens rotated and revocable; sessions end on password change, disable, delete                                                                                    | `auth-flow.e2e-spec.ts`, `short-access-token.e2e-spec.ts`, browser tests of the account                 |
| A08 | Software and data integrity failures     | Risk   | Lockfile committed; uploads identified from their bytes and re-encoded; audit log append-only from the application. No CI yet to enforce the checks on every change                                                       | [Remaining risks](#remaining-risks)                                                                     |
| A09 | Logging and monitoring failures          | Risk   | Structured logs without personal data; audit log of every back-office write and sensitive read. No alerting yet (comes with the Azure deployment)                                                                         | `logger.config.spec.ts`, audit assertions in the e2e tests                                              |
| A10 | Server-side request forgery              | OK     | The API fetches no URL given by a user. Its only outgoing calls go to configured hosts: the mail service (Azure Communication Services, or SMTP locally), Blob Storage, Turnstile, and the web app for cache revalidation | Code review; `site-cache.service.ts`                                                                    |

## Access control

### Every route

`apps/api/test/e2e/security.e2e-spec.ts` reads the routes from the running application, so a new route is covered the day it is added:

- the routes open to visitors are exactly a list written in the test; adding `@Public()` to a route fails the test until the list is changed on purpose;
- every route under `admin/` has an explicit list of roles, and `CANDIDATE` is never in it;
- every other route answers 401 without a session;
- every back-office route answers 403 to a signed-in candidate.

Roles are read from the database on each request, not from the token: a role change, a disabled account or a forced logout applies to the very next request.

### Country agents

A `COUNTRY_AGENT` reaches only the candidates whose nationality is one of his countries, their documents and their applications ([ADR-024](adr/ADR-024-country-agents.md)). The scope is applied in the API (`candidateScope`) on every list, search, detail, status change, note, document download and dashboard figure; anything else answers 404, never the data. Every back-office route whose roles leave him out answers 403: the test reads the list of routes from the running application, so a new route is covered the day it is added. Tests: `country-agent.e2e-spec.ts` (404 for every out-of-scope record, 403 for every forbidden route, nationality and not residence), `admin-country-agents.spec.ts` (Moroccan and Tunisian agents in the browser).

### Records of somebody else (IDOR)

Documents, applications and profiles are always looked up together with their owner. A candidate who asks for a record of another candidate gets 404, the same answer as for a record that does not exist. Tests: `rbac.e2e-spec.ts` ("hides another candidate's profile, document and application behind a 404"), `applications.e2e-spec.ts` (cannot attach another candidate's document, cannot withdraw another candidate's application), `candidate-profile-documents.e2e-spec.ts` (cannot delete another candidate's document).

Files are never served from a public address. `GET /documents/:id/download` checks the caller, then redirects to a link signed for 5 minutes, read-only. Downloads by back-office users are written to the audit log.

### CSRF

Two layers:

1. The session cookies are `SameSite=Lax`, `HttpOnly`, `Secure`: a form or a script on another site cannot send them with a POST.
2. `originCheck` (`apps/api/src/common/http/origin-check.ts`) refuses any state-changing request whose `Origin` (or `Referer`) is not the web app (`WEB_ORIGIN`, or one of `WEB_ORIGIN_ALIASES`: the default Azure address, whose pages the web app redirects to the custom domain). Requests without either header (curl, server-to-server) go on to the normal checks, where they still need a session.

The browser only ever talks to the web origin; the web app forwards `/api/v1/*` to the API. CORS on the API is limited to the same origins.

## Injection and XSS

- **SQL**: about 30 raw queries, all written as `Prisma.sql` / tagged templates, which bind every value. The only `Prisma.raw` wraps a numeric constant of the code (`MAX_JOBS_PER_EMAIL`). There is no `$queryRawUnsafe`. Full-text search builds its `tsquery` with `websearch_to_tsquery` on a bound parameter.
- **Rich text** (job descriptions written with the Tiptap editor): cleaned by `cleanRichText` with DOMPurify on the server, when written and again when read. Allowed: paragraphs, line breaks, bold, italic, underline, strike, lists, `h3`, `h4`, links, quotes. Links keep `http(s)`, `mailto` and `tel` only and get `rel="noopener noreferrer nofollow"`. `rich-text.spec.ts` feeds it script tags, event handlers, `javascript:` links, SVG and data URLs.
- **Everything else** is rendered by React as text. The site has one `dangerouslySetInnerHTML` for job rich text (cleaned as above) and one for structured data (JSON, escaped).
- **Exports**: cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed so a spreadsheet does not run them as formulas.
- **Content-Security-Policy** on every page of the web app: scripts need the nonce of the page (`'strict-dynamic'`), no `unsafe-eval`, `frame-ancestors 'none'`, images and connections limited to the site, the storage and Cloudflare Turnstile. Styles allow `'unsafe-inline'` (Tailwind and Next.js inject style attributes). The browser tests listen for CSP violations on every page they check and fail on any.

## File uploads

| Risk                                   | Control                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A file that is not what its name says  | The format is detected from the bytes (`inspectDocument`). PDF, JPEG and PNG only. The name sent by the browser is never used as a path              |
| Location in a passport scan or a photo | Images are decoded and re-encoded with sharp: EXIF, GPS position, camera and software fields are removed. An image that cannot be decoded is refused |
| Large files                            | `MAX_UPLOAD_SIZE_MB` (5 MB by default, 25 at most), and at most 30 documents per candidate                                                           |
| Access by address                      | Random names in a private container; links signed for 5 minutes                                                                                      |
| Content served as a page of the site   | Files come from the storage origin, never from the site origin, with their detected content type                                                     |
| **Malware in a PDF**                   | **Not scanned.** See [Remaining risks](#remaining-risks)                                                                                             |

PDF files are stored as received (their metadata is not removed): rewriting a PDF safely needs a parser we do not want to expose to untrusted files. Recruiters open them in the browser's own viewer, sandboxed.

## Authentication and sessions

- Passwords: at least 10 characters and a zxcvbn score of 3; stored with argon2id.
- Access token: 15 minutes, in an `HttpOnly` cookie. Refresh token: 7 days, rotated at each use, stored as a SHA-256 hash, revocable. A reused refresh token ends the session.
- Email tokens (verification, reset, invitation, job alert): random, single use, stored as hashes, with an expiry.
- Register, login, forgot password and resend verification give the same answer whether the address has an account or not.
- Changing the password, disabling or deleting an account ends its sessions at once.
- A super admin may set the password of a back-office account (a new country agent, a lost access). It passes the same policy, is stored as an argon2id hash and never returned, logged (`password` is in `SENSITIVE_KEYS`) or written to the audit log (the entry records the change only). The account's sessions end and, until the person chooses a new password (different from the one given), every route but the password change answers 403 `PASSWORD_CHANGE_REQUIRED`. Tests: `country-agent.e2e-spec.ts` ("accounts"), `roles.guard.spec.ts`.

### Rate limits

Per client address, per minute (`apps/api/src/auth/auth.constants.ts`):

| Routes                                                                          | Limit |
| ------------------------------------------------------------------------------- | ----- |
| Sign-in, register, forgot password, reset, resend verification, change password | 5     |
| Contact form, job alert of a visitor                                            | 5     |
| Other authentication routes (refresh, session, logout)                          | 20    |
| Everything else                                                                 | 120   |

Register, the contact form, the job alert form and applying also need a Cloudflare Turnstile token.

`RATE_LIMITS_ENABLED=false` turns the limits off for load tests and browser tests, where every user shares one address. The API refuses to start with it when `NODE_ENV=production` (`env.spec.ts`).

Behind the Azure ingress, `TRUST_PROXY_HOPS` must be set so the limit applies to the visitor's address and not to the proxy's.

## Security headers

| Header                      | Value                                                | Set by                  |
| --------------------------- | ---------------------------------------------------- | ----------------------- |
| `Content-Security-Policy`   | Nonce per page, see above                            | `apps/web/src/proxy.ts` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`                | web and API             |
| `X-Frame-Options`           | `DENY` (and `frame-ancestors 'none'`)                | web and API             |
| `X-Content-Type-Options`    | `nosniff`                                            | web and API             |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                    | web                     |
| `Permissions-Policy`        | camera, microphone, geolocation, payment and USB off | web                     |
| `X-Powered-By`              | removed                                              | web and API             |

## Secrets, logs and errors

- No secret is committed. `gitleaks` on the whole git history: no leak (three passwords of test fixtures are allow-listed by path in `.gitleaks.toml`). `.env` files are git-ignored.
- Logs carry ids, never personal data. pino removes `password`, `token`, `passportNumber`, cookies and the authorization header wherever they appear (`logger.config.ts`); request bodies are not logged. After a full browser run (about 1 300 log lines) the API log contained no email address, no passport number, no password and no token.
- Errors answer `{ code, message }`. No stack trace, no SQL, no file path (`security.e2e-spec.ts`). Configuration errors name the variable, never its value.
- Emails waiting in the outbox are encrypted in the database; their content is erased once sent.
- Telemetry (Application Insights) carries no personal data: query strings are removed from every URL (email links carry tokens), health probes are not recorded, exceptions keep their type and stack but not their message, custom events carry ids and statuses only (`apps/api/src/telemetry/telemetry.spec.ts`, `apps/web/src/lib/telemetry-redact.test.ts`, ADR-019).
- Lifting the re-application waiting period (`POST /admin/applications/:id/waive-cooldown`) is for super admins only, needs a reason, writes `application.waive_cooldown` to the audit log, and is never shown to the candidate (`cooldown-waiver.e2e-spec.ts`).
- `POST /admin/diagnostics/error` (fails on purpose, to check the alerts) is for super admins only and audited (`diagnostics.e2e-spec.ts`).
- Database backups (weekly `pg_dump`) go to the private `backups` container with the managed identity: no account key, no SAS, no public access; passport numbers stay encrypted inside the dump. Reading a dump needs a data role on the storage account; a local copy for a restore test is deleted afterwards (docs/RUNBOOK.md).
- Production email has no password to leak: the API sends through Azure Communication Services with its managed identity, whose role is scoped to that one Communication Service. Open and click tracking is off on the domain and on every message (`azure-email.transport.spec.ts`). Data of the service stays in Europe.

## Data protection

### Passport numbers

Stored in two columns, written only by `protectPassportNumber`:

- `passport_number_encrypted`: AES-256-GCM with a random nonce, the key from `FIELD_ENCRYPTION_KEY` (Key Vault in Azure), and the column name as additional data, so a value copied to another column does not decrypt;
- `passport_number_masked`: `*****567`, used by lists, snapshots, exports and audit entries.

The clear number leaves the API in three cases only: to its owner; to a recruiter or super admin who presses "Show" (audited, never a viewer); in an export when a super admin ticks "Full passport number" (audited).

Checked in the development database during the audit: every stored number has the versioned ciphertext format, none is readable.

### Exports

`POST /admin/applications/export` (CSV or Excel): masked passport numbers unless a super admin asks for the full ones; internal comments and notes are never included; every export is written to the audit log with its filters and columns. The browser test "applications and candidates in bulk" downloads an export and checks that it holds the masked number and not the clear one.

### What a person can do with their data (GDPR)

| Right   | How                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access  | "Download my data" in the account settings: a zip with `data.json` (account, profile, applications, alerts) and every document. Internal notes and comments are not in it |
| Rectify | The profile and the documents can be changed at any time                                                                                                                  |
| Erase   | "Delete my account": files removed from the storage, profile and account anonymised, job alerts deleted, sessions ended. The email address becomes free again             |
| Object  | Job alerts stop with one click from every email. A super admin can remove every alert of an address on request (`POST /admin/job-alerts/erase`)                           |

After an erasure, applications stay as rows without any personal data (job, dates, final status), so the figures of the dashboard do not change. Nobody can move such an application any more.

Tests: `gdpr.e2e-spec.ts` (12 tests), the browser tests of the account and of the back-office deletions.

### Retention

Personal data is not kept for ever. The scheduled task `retention` (`RetentionService`) runs with the other scheduled tasks:

| Data                                    | Kept                                                                           | Then                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Candidate account, profile, documents   | 24 months after the last activity (sign-in, application sent or moved)         | A warning email 30 days before; then the same erasure as "Delete my account"                            |
| Account with an application in progress | As long as the recruitment goes on                                             | Never erased by the task                                                                                |
| Messages of the contact form            | 24 months                                                                      | Deleted                                                                                                 |
| Job alert not confirmed                 | 72 hours                                                                       | Deleted                                                                                                 |
| Sent and cancelled emails of the outbox | 30 days (content already erased when sent)                                     | Deleted                                                                                                 |
| Refresh tokens                          | 7 days                                                                         | Expired; removed with the session                                                                       |
| Anonymous applications, audit log       | Kept                                                                           | They hold no personal data of candidates: reasons and counts only                                       |
| Database backups                        | 7 days (automatic backups), 30 days (weekly dumps, then 7 days of soft delete) | Deleted: an erased account leaves the backups after 37 days at most ([ADR-020](adr/ADR-020-backups.md)) |

Signing in after the warning is enough to keep the account. Each automatic erasure writes an audit entry (`candidate.retention_delete`, actor "system") with counts, not names. The periods are constants of `packages/shared` (`RETENTION_MONTHS`, `RETENTION_NOTICE_DAYS`); the privacy policy of the site must say the same, and both should be confirmed by the agency's legal adviser.

Tests: `retention.e2e-spec.ts` (8 tests, at the exact boundaries).

## Dependencies

Run during the audit, and to run again before each release:

| Tool                              | Scope                                  | Result                                                                                         |
| --------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm audit --prod`               | What ships to production               | No known vulnerability                                                                         |
| `pnpm audit`                      | Everything, development tools included | 1 high: `braces` (see below)                                                                   |
| `trivy fs` (vuln, secret, config) | Lockfile and repository                | 0 high or critical                                                                             |
| `gitleaks git`                    | The whole git history                  | No leak                                                                                        |
| `gitleaks dir`                    | Working tree                           | 9 hits, all in git-ignored files (the local `.env`, the Next.js build output); none is tracked |
| `eslint-plugin-security`          | All workspaces, part of `pnpm lint`    | No finding                                                                                     |

23 October 2026: `next build` stopped on new advisories for Next.js 16.4.0 (GHSA-2464-fhr4-w9xw and GHSA-673q-mjm6-r5xr, critical, unauthenticated code execution; GHSA-p3m5-59mp-jv5r, high, denial of service) and `pnpm audit --prod` also listed DOMPurify ≤ 3.4.16 (GHSA-cg2g-xh64-v4q7 critical, GHSA-mrv2-3pqr-j5jr high, GHSA-c6gr-qvv4-5v3f low) through `isomorphic-dompurify`. Raised to Next.js 16.4.2 (with `eslint-config-next`) and `isomorphic-dompurify` 4.6.0 (DOMPurify ≥ 3.4.17); `pnpm audit --prod` is clean again. Dependabot and the weekly `security.yml` run keep watching.

24 October 2026: the image scan blocked a deployment on `@azure/msal-node` 6.0.1 (CVE-2026-109461, HIGH, fixed in 7.1.0), which `@azure/identity` 4.14 still requires; `pnpm audit --prod` also listed new denial-of-service advisories in `zod`, `body-parser`, `multer`, `undici` and `nodemailer`. Fixed with overrides (`@azure/msal-node` ^7.1.0, `body-parser@2` ^2.4.0, `multer@2` ^2.5.0, `undici@6` ^6.29.1, `undici@7` ^7.30.1) and direct updates (`zod` 4.6.7, `nodemailer` 10.2.1). The only breaking change of msal-node 7 is the interactive browser sign-in, which managed identity does not use; checked in Azure after the deployment (storage and email calls).

Fixed during the audit: `uuid` (through exceljs), `mysql2` and `deepmerge-ts` were raised with `pnpm.overrides`; the `shadcn` package, which was only needed for one CSS file, was removed and the file vendored.

**Accepted: `braces` ≤ 3.0.3** (GHSA-vfj7-8cjw-p6xm, stack exhaustion with deeply nested brace patterns; no fixed version exists). It comes only through `eslint-config-next → fast-glob → micromatch`, a lint tool. It is not installed in production, and the only patterns it ever receives are the ones written in our own ESLint configuration. To revisit when `braces` or `@next/eslint-plugin-next` publishes a fix.

A deprecation warning of the `pg` driver ("client is already executing a query") appears in the API log. It comes from inside Prisma 7.10, which sends the queries of one `include` in parallel inside a transaction; it is harmless with `pg` 8 and needs a Prisma update before `pg` 9.

## Remaining risks

Nothing here is rated high or critical. In order of importance:

1. **No malware scanning of uploaded files.** A candidate could upload a PDF that attacks the reader of the recruiter who opens it. Today: PDF, JPEG and PNG only, images re-encoded, files served from the storage origin and opened in the browser's sandboxed viewer. The complete answer is **Microsoft Defender for Storage** (malware scanning on upload, billed per GB scanned on top of a monthly fee per storage account; check the current Azure prices): a paid option to decide with the deployment. Until then, recruiters should open documents in the browser and not download and open them with desktop software.
2. **No CI yet.** The checks (lint, types, tests, audits, secret scan) run on the developer's machine. A change could be merged without them. To do with the deployment work: GitHub Actions running `pnpm lint`, `typecheck`, `test`, `test:e2e`, `test:browser`, `pnpm audit --prod`, trivy and gitleaks on every pull request.
3. **No alerting.** Failed sign-ins, 5xx answers and failed scheduled tasks are logged but nobody is told. To do with the deployment: Azure Monitor alerts on the log queries.
4. **`style-src 'unsafe-inline'`** in the CSP. Script injection is still blocked by the nonce; an injected style could at most change how a page looks.
5. **Emails abandoned after about three days** of SMTP outage (20 attempts) are marked failed and their content erased. They are counted by the `send-emails` task report; nobody is alerted (see 3).
6. **Rate limits are per address.** A distributed attack on sign-in is slowed by argon2 and by Turnstile on registration, not by the limit. Azure Front Door or the Container Apps ingress can add limits per region if needed.
7. **Retention periods and policy texts** were chosen by the developers. They need a legal review before the site opens.
8. **Local development over HTTP.** Session cookies are `Secure`; Chromium and Firefox accept them on `http://localhost`, Safari does not. Production is HTTPS only.
