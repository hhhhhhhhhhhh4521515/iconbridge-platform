# Journal

Dated log of the work on IconBridge Jobs. Newest entry at the bottom. Each entry says what was done, why, which checks ran, and links the pull request.

## 2026-10-10 - Repository foundation

**What**

- Monorepo with pnpm workspaces and Turborepo: `apps/web` (Next.js 16 App Router, Tailwind CSS 4, shadcn/ui with RTL), `apps/api` (NestJS 12, Prisma 7), `packages/shared` (zod schemas, enums, types), `packages/config` (ESLint, Prettier, tsconfig presets).
- API: global prefix `/api/v1`, Swagger at `/api/docs`, `/health/live` and `/health/ready` (database check, 503 when it fails), environment validated with zod at startup.
- Web: placeholder home page that uses the shared destinations and a shadcn button.
- `docker-compose.yml`: PostgreSQL 16, Azurite, Mailpit, pgAdmin under the `tools` profile, all with health checks.
- `.env.example` for root, api and web; `pnpm env:init` to copy them.
- Husky, lint-staged, commitlint, EditorConfig, `.dockerignore`; `.gitignore` extended.
- `CLAUDE.md`, `.claude/settings.json` (permission allow / ask / deny lists).
- Docs: `SPEC.md` (from `SPEC-input.md`, restructured, content unchanged), `ARCHITECTURE.md`, ADR-001, this journal; `00-environment.md` extended.
- Private GitHub repository `iconbridge-platform`, `main` pushed.

**Why**

Base for every later feature: one place for shared validation, the same lint and type rules everywhere, and a local stack that mirrors the Azure services (PostgreSQL, Blob Storage, SMTP).

**Choices worth knowing** (details in ADR-001)

- NestJS 12 is ESM and its template uses Vitest, so the API follows that: relative imports end in `.js`.
- TypeScript 6.0.x and ESLint 9.x are pinned because typescript-eslint, the Nest CLI and `eslint-config-next` do not support TypeScript 7 / ESLint 10 yet. Prisma is pinned to 7.10.0 because npm `latest` is an 8.0 release candidate.
- Health endpoints are outside the `/api/v1` prefix: `http://localhost:4000/health/ready`.
- Mailpit SMTP is on host port 2525, not 1025: Windows reserves ports 1024-1123 on this workstation and Docker could not publish 1025. The UI is on 8025 as planned.
- The Prisma schema has no model yet; the client is only used for the readiness query. `pnpm db:migrate` and `pnpm db:seed` run but have nothing to apply.

**Checks**

| Check                                                                           | Result                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` (also as `pnpm lint typecheck test`) | Pass; 31 tests (shared 11, api 17, web 3)                                                              |
| `pnpm build`                                                                    | Pass                                                                                                   |
| `pnpm dev`                                                                      | Compose services healthy, web and api started                                                          |
| `GET http://localhost:3000`                                                     | 200, placeholder page                                                                                  |
| `GET http://localhost:4000/api/docs`                                            | 200, Swagger UI                                                                                        |
| `GET http://localhost:4000/health/ready`                                        | 200 `{"status":"ok","checks":{"database":"ok"}}`; 503 with PostgreSQL stopped, 200 again after restart |
| Mailpit                                                                         | UI 200 on 8025; a test message sent over SMTP was read back through `/api/v1/messages`                 |
| API started without its variables                                               | Exits with code 1 and lists the missing names                                                          |
| `pnpm db:migrate`, `pnpm db:seed`                                               | Run against the local database                                                                         |

**PR**: none. This is the initial commit, pushed directly to `main` to create the repository. Branch protection comes with the CI step; from now on every change goes through a `feat/` branch and a PR.

**Remaining**: data model, authentication, features of `SPEC.md`, Dockerfiles, Terraform, CI/CD and protection of `main`.

## 2026-10-10 - Data model

**What**

- Prisma schema with 19 tables: users and tokens, candidate profile, languages and documents, destinations, categories and jobs, applications with attached documents, status history and internal notes, success stories, home slides, job alerts, contact messages, settings and audit log.
- First migration (`init`), applied to the local database. It includes hand-written SQL: the generated full-text column of `jobs` with its GIN index, and 11 CHECK constraints (hired count within positions, salary range, consent before publishing a story, lower-case emails...).
- Passport number encrypted in the API with AES-256-GCM (`FieldCipher`), stored with a masked version; new required variable `PASSPORT_ENCRYPTION_KEY`.
- Password hashing helper (argon2id), used by the seed and later by authentication.
- Idempotent seed: 3 destinations, 7 categories, 3 settings, the super admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`; in development 12 sample jobs, 3 home slides, 4 success stories and 5 fake candidates.
- `packages/shared`: enums for gender, education level, language level, document type, salary period and email token type; locales and the translated-text schema; setting keys with their schemas and defaults.
- `pnpm env:init` now also adds variables missing from an existing `.env` and generates the local encryption key and seed password.
- Docs: data model, ER diagram and sensitive-data sections in `ARCHITECTURE.md`; ADR-002.

**Why**

Every feature of the specification reads or writes these tables. Fixing keys, constraints and the handling of the passport number now avoids data migrations later.

**Choices worth knowing** (details in ADR-002)

- Prisma reported drift on the generated column until its expression was repeated in the schema as a `dbgenerated` default. `prisma migrate dev` no longer generates the client in Prisma 7, so `pnpm db:migrate` runs `prisma generate` afterwards.
- Full-text search uses the `simple` configuration (no stemming) because offers are multilingual.
- Added beyond the list in the prompt: `MAX_UPLOAD_SIZE_MB` setting (SPEC mentions upload limits), `show_employer_name`, three benefit flags plus free text, `required_languages` as an array, `handled_at` on contact messages.
- `home_slides.cta_label` is translated JSON instead of plain text.
- Sample image and consent paths point to blobs that do not exist yet; fake candidates have no documents.
- The seed never updates existing rows, so sample job deadlines are not refreshed by a later run.

**Checks**

| Check                                      | Result                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Pass; 64 tests (shared 17, api 44, web 3)                                                                                 |
| `pnpm build`                               | Pass                                                                                                                      |
| `pnpm db:migrate` twice                    | "Already in sync" both times, no new migration proposed                                                                   |
| `pnpm db:seed` twice                       | Both succeed; row counts identical after the second run (6 users, 12 jobs, 3 slides, 4 stories, 5 profiles, 15 languages) |
| Prisma Studio                              | Starts on port 5555 and its backend returns the seeded rows. Checked over HTTP, not visually in a browser                 |
| Passport columns                           | Stored as `v1.` payloads, no clear number in the table, mask `*******001`                                                 |
| Constraints                                | Updates that break the hired-count, consent, lower-case email and passport-pair rules are rejected by PostgreSQL          |
| Full-text search                           | `search_vector @@ plainto_tsquery('simple','welder')` returns the welder job; the planner can use the GIN index           |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/1>

**Remaining**: authentication, feature endpoints and their database tests, file upload, emails, i18n, Dockerfiles, Terraform, CI/CD.

## 2026-10-10 - Authentication and authorization

**What**

- Auth endpoints under `/api/v1/auth`: register (candidates only, Turnstile, zxcvbn), verify email, resend verification, login, refresh, logout, forgot password, reset password, me.
- Sessions: 15-minute access JWT and 7-day rotating refresh token in `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Refresh tokens are stored hashed; reuse of a rotated token revokes its whole family.
- Protections: argon2id, identical answers for known and unknown emails, lock of 15 minutes after 5 wrong passwords, rate limits (120/min, 20/min on `/auth`, 5/min on sensitive routes).
- RBAC: permission table in `packages/shared` mirroring SPEC.md, `@Roles()`, `@Public()`, global `JwtAuthGuard`, `RolesGuard` and `VerifiedEmailGuard`, plus `OwnershipGuard` for candidate-owned records.
- Admin accounts (`/api/v1/admin/users`, super admin only): list, create with invitation email, change role, disable, enable, force logout; the last super admin is protected and nobody can disable themselves.
- Audit: global interceptor recording every back-office write with before and after; `GET /api/v1/admin/audit-logs`.
- Global: helmet, CORS limited to `WEB_ORIGIN`, zod validation pipe, exception filter returning `{ code, message, details }`, pino logs with request id and redaction.
- Mail: Nodemailer + MJML, four templates in English, French and Arabic (right-to-left).
- Migration `auth`: `users.locale`, `failed_login_count`, `locked_until`, `token_version`, nullable `password_hash`; `refresh_tokens.family_id`; email token type `INVITATION`.
- New variables: `JWT_ACCESS_SECRET`, `TURNSTILE_SECRET_KEY`, `SMTP_USER`, `SMTP_PASSWORD`, `TRUST_PROXY_HOPS`.
- Tests: `pnpm test:e2e` runs the API over HTTP against a PostgreSQL test database created automatically.
- Swagger documents every auth and admin route, with request bodies generated from the zod schemas and cookie authentication.

**Why**

Every later feature (profile, documents, applications, back office) depends on knowing who is calling and what they may do. Building the guards with fail-closed defaults now means a forgotten decorator on a future route refuses access instead of granting it.

**Choices worth knowing** (details in ADR-003)

- The user is read from the database on each request, so disabling an account or forcing a logout is immediate.
- Candidates can sign in before verifying their email; `@RequireVerifiedEmail()` will block applying.
- A locked account answers the same error as a wrong password, to avoid revealing which emails exist.
- The invitation link and the reset link use the same endpoint, `POST /auth/reset-password`.
- No profile, document, job or application endpoint exists yet. Ownership and the role matrix are tested through test-only controllers that use the real guards and decorators.
- Health probes no longer go through the error format: `/health/ready` keeps its `{ status, checks }` body on 503.
- During verification the workstation lost internet access and registration failed because Cloudflare could not be reached. Outside production the API now accepts Cloudflare's always-pass test secret without a network call, and production refuses to start with a test secret.
- **To settle in the infrastructure step**: with `SameSite=Lax` cookies the web app and the API must be on the same site in production (custom domain or a proxy); the default Container Apps hostnames are not.

**Checks**

| Check                                                          | Result                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`                                  | Pass                                                                                                                      |
| `pnpm test`                                                    | Pass: 211 unit tests (shared 39, api 169, web 3)                                                                          |
| `pnpm test:e2e`                                                | Pass: 83 tests in 5 files, against `iconbridge_test`                                                                      |
| `pnpm build`                                                   | Pass                                                                                                                      |
| `pnpm db:migrate` twice                                        | Migration `auth` applied, then "Already in sync"                                                                          |
| Live: register with `locale=fr`                                | 201; the French verification email is in Mailpit (read through its API); the link verifies once, a second use answers 400 |
| Live: candidate on `/admin/users` (GET and POST)               | 403                                                                                                                       |
| Live: viewer invited by the seed super admin                   | Arabic invitation in Mailpit, password set, login 200; GET, POST, PATCH on `/admin/users` answer 403                      |
| Live: force logout                                             | The viewer's next request answers 401                                                                                     |
| Live: super admin disables self / demotes the last super admin | 409 `CANNOT_DISABLE_SELF` / 409 `LAST_SUPER_ADMIN`                                                                        |
| Live: cookies                                                  | `HttpOnly`, `Secure`, refresh cookie limited to `/api/v1/auth`                                                            |
| Live: logs                                                     | Request id on each line; no password or cookie value found in the log file                                                |

The accounts created by the live checks were removed from the development database afterwards.

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/2>

**Remaining**: candidate profile and documents, jobs, applications and the re-application rule, back-office screens, the web pages behind the email links, Turnstile on apply and contact, Dockerfiles, Terraform, CI/CD (with a PostgreSQL service for `pnpm test:e2e`).

## 2026-10-10 - Job offers

**What**

- Public endpoints: `GET /jobs` (filters by destination, category, salary range, currency, language, featured; text search; sort by relevance, newest, deadline or salary; page pagination), `GET /jobs/:slug`, `GET /destinations`, `GET /categories`, `GET /stats` (cached 10 minutes).
- Search: prefix full-text search on the existing `tsvector` column, combined with pg_trgm word similarity on the title. Migration `job_search_trigram` adds the extension and a GIN trigram index.
- Back office `/admin/jobs`: list, read, create, update, delete (soft, or permanent when no application exists), publish, close, reopen, archive, duplicate, feature, unfeature, cover upload and removal.
- Back office `/admin/destinations` and `/admin/categories`: list, create, update, remove (deactivated instead of deleted when in use).
- Slugs generated from title and destination, unique, stable once the job has been published.
- Cover images: format read from the bytes, resized to 1200 px, re-encoded as WebP, stored in the `public-media` blob container.
- Scheduled task every 15 minutes that closes expired or full jobs, protected by a PostgreSQL advisory lock, with a log line and an audit entry per job.
- Every admin write is audited with before and after snapshots of the job, destination or category.
- Shared package: job schemas, list queries, status transition table, `isJobOpen`, slug helpers.
- New variable `PUBLIC_MEDIA_BASE_URL`; Azurite now starts with `--skipApiVersionCheck`.
- Docs: job section in `ARCHITECTURE.md`, ADR-004, Terraform notes.

**Why**

Jobs are what visitors come for and what applications attach to. The visibility rule (published, not deleted, deadline not passed, positions left) is the most important business rule of this step, so it is defined once and used by every public query.

**Choices worth knowing** (details in ADR-004)

- Visibility does not depend on the scheduled task: an expired job answers 404 at once, and the task only brings the stored status in line. This matters because the API will scale to zero.
- Jobs whose positions are all filled are hidden too, in addition to what the prompt listed.
- Typos are tolerated on titles only; descriptions get prefix matching ("guest" finds "guests").
- Page pagination was chosen over cursors.
- A viewer can read jobs, destinations and categories in the back office.
- Fixed along the way: the audit entry of an action that creates a record from a route with `:id` (duplicate) pointed at the source record. With `@Audit`, the record is now `idParam` or, without it, the id of the response.
- Not built: restoring a soft-deleted job.
- **For the infrastructure step**: allow-list `PG_TRGM` on the PostgreSQL server, and allow anonymous read on the `public-media` container (or serve it through a CDN).

**Checks**

| Check                                                          | Result                                                                                                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`                    | Pass                                                                                                                                                                                                                 |
| `pnpm test`                                                    | Pass: 259 unit tests (shared 65, api 191, web 3)                                                                                                                                                                     |
| `pnpm test:e2e`                                                | Pass: 195 tests in 8 files                                                                                                                                                                                           |
| `pnpm db:migrate` twice                                        | Migration applied, then "Already in sync"                                                                                                                                                                            |
| Live: `GET /jobs` on the seeded data                           | 10 open jobs (the draft and the closed sample are absent)                                                                                                                                                            |
| Live: `?q=welders`                                             | Finds "MIG/MAG Welder"; `?q=reciptionist` finds "Hotel Receptionist"                                                                                                                                                 |
| Live: closed sample job `GET /jobs/sample-fruit-picker-poland` | 404                                                                                                                                                                                                                  |
| Live: create, publish, close as the seed super admin           | Public 404 before publishing, 200 after, 404 after closing                                                                                                                                                           |
| Live: cover upload to Azurite                                  | 2400x1600 JPEG stored as 1200x800 WebP, readable anonymously; a text file named `.png` answers 415                                                                                                                   |
| Swagger                                                        | `/api/docs` answers 200; the OpenAPI document lists the 5 public paths, the `GET /jobs` parameters and 14 admin job, destination and category paths. Checked through the JSON document, not by clicking in a browser |
| Live: scheduled task                                           | A published job whose deadline was moved to the past was closed by the 23:30 run; the log shows its slug and `deadline_passed`, and the audit log has a `job.auto_close` entry without actor                         |

The jobs created by the live checks were deleted afterwards.

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/3>

**Remaining**: candidate profile and documents (private storage), applications and the re-application rule, back-office screens, web pages, Dockerfiles, Terraform, CI/CD.

## 2026-10-10 - Candidate side

**What**

- Profile: `GET` / `PUT /me/profile` with every field of the specification, validated with zod (18 or older, ISO 3166 country list, E.164 phones, passport not expired), passport number encrypted at rest, completeness percentage and missing items.
- Documents: `POST /me/documents` (format checked from the content with `file-type`, size limit from the settings, random blob name, SHA-256), `GET /me/documents`, `DELETE /me/documents/:id`, and `GET /documents/:id/download` answering 302 to a 5-minute read-only signed link. Back-office downloads are audited.
- Storage behind an interface, with an Azure implementation that works with Azurite or an account key (service SAS) and with a managed identity (user-delegation SAS). New variable `AZURE_STORAGE_ACCOUNT_URL`; exactly one of it and the connection string must be set.
- Applications: `POST /jobs/:id/apply`, `GET /jobs/:id/eligibility`, `GET /me/applications`, `POST /me/applications/:id/withdraw`. The 6-month rule runs in a transaction under PostgreSQL advisory locks and reads its duration from the settings.
- Profile and document snapshot at apply time; confirmation email to the candidate and a notice to recruiters, in three languages.
- GDPR: `GET /me/export` (zip with `data.json` and the documents) and `DELETE /me/account` (files deleted, profile and applications anonymised).
- Supporting pieces: injectable `Clock`, `SettingsService`, the full ISO 3166-1 country list in `packages/shared`, audit of selected reads, top-level `nextAllowedAt` in the error body.
- Docs: candidate section in `ARCHITECTURE.md`, ADR-005, Terraform notes.

**Why**

This is the purpose of the platform: a candidate fills in a profile, uploads a CV and a passport, and applies. The 6-month rule is the business rule the specification insists on, so it is enforced in the database transaction and tested at its exact boundary.

**Choices worth knowing** (details in ADR-005)

- One function decides eligibility for both the eligibility endpoint and `apply`.
- Two advisory locks: per candidate (exact limit of active applications) and per candidate + job (the rule).
- Applying needs a CAPTCHA token, as the specification asks for apply, although the prompt did not list it.
- The selected documents must include a CV and a passport scan.
- A candidate does not see the comment of a status change, since recruiters may write internal remarks there.
- A missing or draft job answers 404; a closed, expired or full one answers `409 JOB_NOT_OPEN`.
- Recruiter notices go only to accounts that accepted their invitation.
- Account deletion asks for the password and deletes files before touching the database.
- Not done: malware scanning of uploads; back-office endpoints to read candidates and applications.
- **For the infrastructure step**: the managed identity needs `Storage Blob Data Contributor` and `Storage Blob Delegator`; set `AZURE_STORAGE_ACCOUNT_URL` instead of a connection string.

**Checks**

| Check                                                 | Result                                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`           | Pass                                                                                                                                    |
| `pnpm test`                                           | Pass: 340 unit tests (shared 102, api 235, web 3)                                                                                       |
| `pnpm test:e2e`                                       | Pass: 308 tests in 11 files                                                                                                             |
| Required: apply twice the same day                    | 409 `REAPPLY_COOLDOWN` with `nextAllowedAt`                                                                                             |
| Required: after 5 months 29 days / exactly 6 months   | 409 / 201 (also 409 one millisecond before)                                                                                             |
| Required: first application Rejected or Withdrawn     | Still 409                                                                                                                               |
| Required: a different job                             | 201                                                                                                                                     |
| Required: two parallel requests                       | One 201, one 409, one row (also checked with eight)                                                                                     |
| Required: `.pdf` name with EXE content                | 415 `UNSUPPORTED_FILE`, nothing stored                                                                                                  |
| Required: candidate A on candidate B's document       | 404, no link                                                                                                                            |
| Live (Azurite): upload a CV, follow the download link | 302; link read-only, valid 300 s; the downloaded file is identical; without or with a tampered signature 403; a write with the link 403 |
| Live: passport number                                 | Returned in clear to the owner; the database column starts with `v1.` and does not contain the number                                   |
| Live: apply, apply again, withdraw, apply again       | 201, 409 with `nextAllowedAt` six months later, withdrawn, 409                                                                          |
| Live: emails in Mailpit                               | Confirmation to the candidate and "New application" to the seed super admin                                                             |
| Live: export and account deletion                     | Zip with `data.json` and both files; after deletion the session answers 401 and the old link 404                                        |
| Swagger                                               | The OpenAPI document lists the 10 new paths (checked through the JSON)                                                                  |

The accounts created by the live checks were removed from the development database afterwards.

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/5>

**Remaining**: back-office candidate and application management (status changes with emails, notes, Kanban, CSV export), success stories and home content, contact form and job alerts, the web application, Dockerfiles, Terraform, CI/CD.

## 2026-10-11 - Back office

**What**

- Applications management (`/admin/applications`): list with filters (job, destination, status, dates, nationality, language, name or email), sort and pagination; detail with snapshot, documents, history and notes; status change through a state machine; bulk status change; internal notes; CSV and XLSX export.
- State machine in `packages/shared`: one step forward or Rejected; Rejected and Withdrawn final unless a super admin reopens; Deployed final and counted in `jobs.hired_count`.
- Each change stores an internal comment and an optional message to the candidate, writes a history row and an audit entry, and emails the candidate in their language.
- Candidates (`/admin/candidates`): search, detail with profile, documents and applications, disable and enable.
- Success stories and home slides: CRUD, photo and image upload, consent upload required before publishing, reorder, "create from application", public `GET /success-stories` and `GET /home-slides`.
- Settings for the super admin, public `GET /site-info`, dashboard `GET /admin/stats`.
- Job alerts with double opt-in and unsubscribe, sent by a batch; contact form stored and emailed to the agency.
- Scheduled tasks as CLI commands (`pnpm --filter @iconbridge/api task <name|all>`), with the in-process scheduler behind `SCHEDULER_ENABLED`; both protected by advisory locks.
- Migration `back_office`: message to candidate in the history, story first and last name with a full-name flag, optional slide image, job-alert confirmation and notification tables, two CHECK constraints.
- Docs: back-office section in `ARCHITECTURE.md`, ADR-006, Terraform notes.

**Why**

This is the daily tool of the agency: following each candidate to deployment while keeping them informed. The scheduled-task change prepares the Azure deployment, where the API scales to zero.

**Choices worth knowing** (details in ADR-006)

- The pipeline is strict: no skipping and no stepping back. A super admin reopens a rejected or withdrawn application to Under review.
- Deployed is refused when every position of the job is filled (`409 NO_POSITION_LEFT`).
- The candidate detail shows the clear passport number, to viewers too, and each view is audited. Lists, snapshots and ordinary exports show the masked number.
- An export with full passport numbers needs a super admin, the column and a separate flag; it is logged without the numbers.
- Phone numbers are not altered by the spreadsheet-formula protection; other cells starting with `= + - @` are.
- A job-alert subscription is one row per request; several alerts per address are possible.
- Recruiter notices and alert emails are sent in sequence inside the request or the batch.
- Not built: a screen for contact messages, undo of a status change, the data-retention task.
- The migration renames `success_stories.display_name` to `first_name`; existing sample rows keep their name.

**Checks**

| Check                                                           | Result                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`                     | Pass                                                                                                                            |
| `pnpm test`                                                     | Pass: 384 unit tests (shared 122, api 259, web 3)                                                                               |
| `pnpm test:e2e`                                                 | Pass: 376 tests in 14 files                                                                                                     |
| `pnpm db:migrate` twice                                         | Migration applied, then "Already in sync"                                                                                       |
| Required tests: state machine                                   | Shared unit tests and e2e: no jump, no step back, final statuses, reopen by super admin only                                    |
| Required tests: hired count                                     | Incremented on Deployed only; last position; two concurrent deployments give one success                                        |
| Required tests: export permissions                              | Viewer and candidate 403; recruiter gets masked numbers and 403 for full ones; super admin needs the explicit flag; audit entry |
| Required tests: consent rule                                    | Publish refused without consent (API and database), allowed after upload                                                        |
| Live: recruiter moves an application from Submitted to Deployed | 8 changes accepted; a jump to Visa approved refused with the allowed list                                                       |
| Live: candidate emails in Mailpit                               | 8 emails, one per step, in French, each with the message for the candidate; no internal comment                                 |
| Live: hired count of the job                                    | 0 to 1                                                                                                                          |
| Live: exports                                                   | CSV with masked numbers for the recruiter, 403 for full numbers; super admin export logged; XLSX opens with exceljs             |
| Live: story from the deployed application                       | Draft "Pipeline C."; publish refused, then accepted after the consent upload; visible on `GET /success-stories`                 |
| Live: contact form and job alert                                | Email to the agency address with reply-to; confirmation email, then confirm 204                                                 |
| Live: `pnpm --filter @iconbridge/api task all`                  | Two JSON reports, exit code 0; unknown task prints the usage                                                                    |
| Swagger                                                         | Checked through the OpenAPI document, not by clicking in a browser                                                              |

The accounts, applications and messages created by the live checks were removed from the development database afterwards.

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/6>

**Remaining**: the web application (public site, candidate area, back office), Dockerfiles, Terraform (including the scheduled job), CI/CD, data retention.

## 2026-10-11 - Public web application

**What**

- Brand assets cleaned up: double extensions removed, extensions matching the real file type, lower-case names without spaces (`story-candidate-26`, `story-candidate-27`), then converted to WebP (7.6 MB to 4.3 MB). The logo keeps a PNG for icons.
- Design system from the logo and posters (navy, royal blue, gold), Inter and Cairo fonts, light and dark mode, 44 px touch targets, visible focus, skip link.
- next-intl with `/fr` (default), `/en` and `/ar` (right-to-left), language switcher, all texts in message files.
- Layout: top bar with the contact details of the settings, sticky header, footer with categories, contact, social links and legal pages.
- Home page: hero slider (Swiper, 6 s autoplay, fade, slow zoom, Motion text entrance, progress bar, pause on hover and with a button, swipe, reduced motion), search bar, count-up counters, destination cards, categories, latest jobs, "How it works" timeline, success stories with a "Visa approved" badge, trust section with the anti-scam notice, FAQ, job alert form, contact call to action.
- Jobs: list with filters in the URL, search, pagination, skeleton and empty state; job page with benefits, countdown, share buttons, JSON-LD `JobPosting` and an Apply button driven by the eligibility endpoint.
- Pages: success stories with a destination filter, about, contact (form with Turnstile), privacy, terms, 404 and error pages; placeholders for login, registration and the candidate area.
- SEO: metadata, canonical and `hreflang` per page and language, Open Graph images, `sitemap.xml` and `robots.txt` built from the open jobs.
- Same-origin API through `proxy.ts`, and a typed client generated from the OpenAPI document (`pnpm api:types`).
- API: `GET /auth/session` (200 for visitors), an OpenAPI export command, a schema for `/site-info`; the development seed now builds the sample slides and stories from the brand images and uploads them to blob storage.
- Playwright smoke tests on a desktop and a phone profile.

**Why**

This is what visitors and search engines see first. Server rendering with per-language URLs serves search engines; the same-origin proxy makes the session cookies of the API work without CORS.

**Choices worth knowing** (details in ADR-007)

- The proxy is a `proxy.ts` rewrite reading `API_INTERNAL_URL` at run time, rather than `rewrites()` in `next.config.ts`, which would freeze the address at build time.
- `cacheComponents` (enabled by the Next.js template) is turned off; pages use `fetch` revalidation.
- Only the hero uses Swiper; the jobs and stories carousels are scroll-snap rows with buttons.
- The first hero slide is server HTML and the carousel code loads a few seconds later; the first change of slide still happens after about 6 seconds.
- A cruise photo exists in the brand folder, so the cruise slide uses it and no gradient was needed.
- Success stories from the brand posters: the first name comes from the file name as asked, which gives odd names for some files (`Fie`, `Fir`, `Name`, `Grand`, `Candidate 26`). Job title, destination (Malta for all) and caption are placeholders; no date is set. They are seeded in development only, with a placeholder instead of a consent document.
- The brand images had been committed with the previous pull request by its final `git add -A`; this one renames and optimises them.
- Hero source images are small (Poland is 612 px wide) and look soft on large screens.
- Login, registration and the candidate area are placeholders; the legal texts are models to be reviewed.

**Checks**

| Check                                       | Result                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Pass                                                                                                                           |
| `pnpm test`                                 | Pass: 391 unit tests (shared 122, api 259, web 10)                                                                             |
| `pnpm test:e2e`                             | Pass: 379 tests                                                                                                                |
| `pnpm test:browser`                         | Pass: 16 tests on a desktop and on a phone profile (32 runs), against the production build                                     |
| Required browser tests                      | Home renders the slider and the success stories; the jobs filter works and keeps the URL; switching to Arabic sets `dir="rtl"` |
| Three languages                             | `/fr`, `/en`, `/ar` answer 200 with the right `lang` and `dir`; `/` redirects to the visitor's language, French otherwise      |
| API proxy                                   | `POST /api/v1/contact` through port 3000 reaches the API; a request id is added; closed jobs answer 404                        |
| Lighthouse mobile, home `/fr`, five runs    | Performance 84, 85, 88, 87, 85; accessibility 100; best practices 100; SEO 100                                                 |
| Lighthouse mobile, other pages              | `/en` 89, `/ar` 73 to 91 between runs, jobs list 87, job page 89, contact 88; accessibility 100 on all                         |

Lighthouse was run on the production build with `--disable-full-page-screenshot`. With the default screenshot step, this GPU-less workstation delays the first paint of the home page by about 2 seconds and the score drops to about 70; a browser measures that first paint at 0.3 s. The performance figures are therefore indicative and should be measured again on the deployed site. "Animates smoothly" was checked by automated tests and screenshots on desktop and phone profiles, not on a physical phone.

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/7>

**Remaining**: login, registration and the candidate area in the web app, the back-office interface, real photos at higher resolution and real consent documents for the stories, legal review of the policy texts, Dockerfiles, Terraform, CI/CD.

## 2026-10-11 - Candidate area of the web application

**What**

- Setup: the `LD_LIBRARY_PATH` workaround for Playwright is gone (system libraries are installed); `pnpm test:browser` runs without it.
- Auth pages on the routes of the emails: `/login`, `/register` (strength meter, consent linked to the privacy policy, Turnstile), `/verify-email`, `/forgot-password`, `/reset-password`, `/set-password`.
- Session: `proxy.ts` protects `/account/*` using the new `ib_session` marker cookie; every API call from the browser renews the session silently on a 401.
- `/account`: completeness bar with the missing items, applications in progress, recommended jobs.
- Profile wizard in seven steps, each saved on "Save and continue"; country lists with flags, phone input with calling code, native date pickers.
- Documents: drag and drop, progress bar, checks before sending, preview, download, delete, passport expiry banner.
- Apply flow: eligibility, documents, cover letter and questions, review, success; the waiting period shows the next allowed date.
- Applications: list, timeline, withdraw with confirmation. Settings: language, password, job alerts, data export, account deletion.
- API additions: `ib_session` cookie, `PATCH /me/settings`, `POST /me/password`, `GET/POST/DELETE /me/job-alerts`, `preferredDestinations` on the profile (migration), `?inline=true` on document downloads, `MAX_UPLOAD_SIZE_MB` in `GET /site-info`.
- All texts in French, English and Arabic (354 new keys).

**Why**

Candidates could read the offers but not register or apply. The reasons for the technical choices are in [ADR-008](adr/ADR-008-candidate-area.md).

**Notes**

- Found by the browser tests and fixed: text typed in a server-rendered form before its scripts started was lost; on phones, hidden labels in the scrolling step list widened the page; `GET /auth/session` shared the strict rate limit of the password endpoints, so a signed-in candidate could be shown "Login to apply"; country names differed between server and browser rendering.
- The Apply button now renews an expired access token before deciding that the visitor is signed out.
- Application emails link to `/account/applications` instead of `/me/applications`.
- Jobs have no question list: two general questions are asked with every application and stored in `answers`.
- Date pickers are the browser's own. They follow the browser language, which may differ from the page language.
- The candidate area was checked in Chromium (desktop and Pixel 7 profiles), not in Safari or Firefox.

**Checks**

| Check                                       | Result                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Pass                                                                                                                                                                                                                                                                     |
| `pnpm test`                                 | Pass: 410 unit tests (shared 123, api 259, web 28)                                                                                                                                                                                                                       |
| `pnpm test:e2e`                             | Pass: 395 tests (16 new for the account endpoints)                                                                                                                                                                                                                       |
| `pnpm test:browser`                         | Pass: 19 tests on a desktop and on a phone profile (38 runs), against the production build, without `LD_LIBRARY_PATH`                                                                                                                                                    |
| Done when: the full scenario                | Pass on both profiles: register, verify the email with the link read from the Mailpit API, complete the profile, upload a CV and a passport, apply, see the application and its timeline, second application blocked with the date; then withdraw and delete the account |
| Screens                                     | Dashboard, wizard, documents, settings, registration checked on screenshots at phone and desktop widths, in English and Arabic; no sideways overflow, no console error                                                                                                   |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/8>

**Remaining**: the back-office interface, per-job questions, real legal texts, Dockerfiles, Terraform, CI/CD.

## 2026-10-11 - Back office of the web application

**What**

- API adjustments: passport numbers masked for every role with an audited reveal action for recruiters and super admins; undo of one's own last status change within 15 minutes, with a correction email when the first one had left; contact-messages inbox; per-job application questions (migration), validated when applying, kept with the application, shown in the detail and in exports; rich text of jobs cleaned on writing and reading; social links in settings and `GET /site-info`; audit-log filters; `newApplicationsThisWeek` in the dashboard figures.
- `/admin` in the web app with its own layout and a menu by role: dashboard (KPI cards and Recharts charts), jobs (TanStack Table, quick actions, form with Tiptap, cover crop, questions, preview), applications (table, Kanban board with drag and drop, detail drawer, bulk change, CSV/Excel export with column picker), candidates, success stories and home slides managers (drag to reorder, live slider preview), destinations and categories, users and roles, contact inbox, settings, audit log.
- Candidate apply flow: the questions of the job replace the two general ones when the job has some.
- Footer social links (Facebook, Instagram, TikTok, LinkedIn, WhatsApp) come from the settings.
- Toasts, optimistic updates (feature a job, reorder, hide a slide, board moves), confirmation dialogs, `/` and Ctrl+K for search, English and French.

**Why**

Recruiters had an API and no screen. Reasons for the choices: [ADR-009](adr/ADR-009-back-office.md).

**Notes**

- Found by the browser tests and fixed: closing a dialog opened from another dialog also closed its parent; the editor toolbar did not follow the cursor; the slider preview widened the page on tablets; a new success story was placed last and so did not reach the twelve the home page shows (new stories now go first).
- `GET /admin/candidates/:id` no longer shows the clear passport number nor writes a `candidate.view` entry; three existing API tests were updated for the changed contracts (candidate detail, site-info keys, story order) and one for the new export column.
- Not covered by a browser test: slides manager, catalog, users page, settings page, audit viewer, contact inbox, bulk change and export dialog. Their endpoints are covered by API tests; the screens were checked on screenshots at 1440 px and 820 px, in English and French, with no console error.
- The browser tests leave their invited accounts (`e2e-recruiter-*`, `e2e-viewer-*`) in the local database; they remove their job, story and candidate.
- Phones are not a target of the back office.

**Checks**

| Check                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Pass                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm test`                                 | Pass: 427 unit tests (shared 132, api 266, web 29)                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm test:e2e`                             | Pass: 423 tests (28 new)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm test:browser`                         | Pass: 41 runs (19 tests on desktop and phone, 3 back-office tests)                                                                                                                                                                                                                                                                                                                                                                  |
| Done when: recruiter scenario               | Pass: invited recruiter sets a password from the Mailpit link, creates and publishes a job with rich text, a question and a cropped cover; the job is on the public site; a candidate applies and answers the question; the board refuses a jump and accepts the next step; undo works; the application reaches Visa approved; a success story is created, refused without consent, published with it, and appears on the home page |
| Done when: role checks                      | Pass: a viewer sees dashboard, jobs, applications, candidates; has no create, edit, export, status, note or reveal button; twelve forced writes or reads of other roles answer 403; the passport number stays masked in the API answer                                                                                                                                                                                              |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/9>

**Remaining**: Dockerfiles, Terraform, CI/CD, legal review of the policy texts, a data retention task.

## 2026-10-11 - Clear error when a dev port is taken

**What**

- `pnpm dev` first runs `scripts/dev-preflight.mjs`: if port 3000 or 4000 is in use it stops and names the port, the process id and the server that could not start.
- The `dev` task of turbo keeps the full output of each server (`outputLogs: full`).

**Why**

`pnpm dev` ended with "@iconbridge/web#dev exited (1)" and nothing else. The cause was `EADDRINUSE`: production builds of the web app and the API, left running on ports 3000 and 4000 after the browser tests of the previous task. The error was printed by Next.js but lost among the output of the other tasks.

**Checks**

| Check                             | Result                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Port taken                        | The check exits 1 with "Port 3000 is already in use by pid ... (node): web (Next.js) cannot start"             |
| Ports free                        | `pnpm dev` starts; `/fr` and `/fr/login` answer 200, `/health/ready` 200, `/api/v1/jobs` through the proxy 200 |
| `pnpm lint`, `pnpm typecheck`     | Pass                                                                                                           |
| `pnpm test`, `pnpm test:e2e`      | Pass: 427 and 423                                                                                              |
| `pnpm build`, `pnpm test:browser` | Not run: no application code changed, and the dev servers were left running on the ports they need             |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/10>

## 2026-10-11 - Historical results, deleting candidates and applications

**What**

- `docs/SPEC.md` first: three rows in the privileges table and a "Counters" section.
- Historical results: table `historical_figures` (migration), `GET/PUT/DELETE /admin/historical-figures` for the super admin, audited with before and after. `GET /admin/stats` returns `platform` and `history` separately; `GET /stats` returns their sum, with a new `partnerCompanies` counter, and its cache is emptied when a figure changes.
- Settings page: section "Historical results" (per year and destination, plus two global figures) and the switch `ALLOW_RECRUITER_DELETE`.
- Dashboard: totals with the split on each card ("252 = 250 historical + 2 platform") and as a tooltip, switch "Including history / Platform only", two charts where the history is its own series.
- Home page: counters use the totals; a "Partner companies" counter appears when there is something to count.
- Deleting a candidate (detail page and bulk) and an application (drawer, table row, bulk), with a dialog that lists what is removed, needs a reason and the word DELETE. `GET /admin/capabilities` tells the screens whether the user may delete.

**Why**

The agency's results from before the platform were missing from its counters, and records created by mistake could not be removed. Reasons for the choices: [ADR-010](adr/ADR-010-historical-results-and-deletions.md).

**Notes**

- Countries are not added: the site shows the larger of "active destinations" and the historical "countries served".
- Deleting an application lowers the application counts (it is a removal); deleting a candidate keeps them, with applications in progress turned into Withdrawn.
- One existing API test was updated for the new `partnerCompanies` field of `GET /stats`.
- Running `pnpm build` while `pnpm dev` was running corrupted the dev server (it answered 500). It was restarted, and the rule is now in `CLAUDE.md`. The browser suite was run on a production build.
- Not covered by a browser test: bulk deletion of candidates and of applications, deletion from the drawer, the recruiter switch in the settings screen, the two global figures in the form. Their endpoints are covered by API tests.

**Checks**

| Check                                       | Result                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Pass                                                                                                                                                                                                                                                                                |
| `pnpm test`                                 | Pass: 429 unit tests (shared 133, api 267, web 29)                                                                                                                                                                                                                                  |
| `pnpm test:e2e`                             | Pass: 447 tests (24 new)                                                                                                                                                                                                                                                            |
| `pnpm test:browser`                         | Pass: 42 runs (19 tests on desktop and phone, 4 back-office tests)                                                                                                                                                                                                                  |
| Done when: 250 historical visas for Malta   | Pass in the browser: the dashboard card shows the total and "total = 250 historical + platform", "Platform only" shows the platform figure alone, the home page counter shows the same total                                                                                        |
| Done when: deleting a test candidate        | Pass in the browser: the signed links to the two files answer 200 before and 404 after, the account answers 401, the number of applications and of approved visas on the dashboard is unchanged, the audit entry holds the reason and the counts and neither the email nor the name |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/11>

**Remaining**: Dockerfiles, Terraform, CI/CD, legal review of the policy texts, a data retention task.

## 2026-10-14 - Security review and QA audit

**What**

- Documents: [SECURITY.md](SECURITY.md) (OWASP Top 10 checklist with the test behind each control, data protection, retention, remaining risks) and [QA-REPORT.md](QA-REPORT.md) (results, coverage, load figures, bugs found). `CLAUDE.md`: stop the servers started for checks; conventions for the outbox, revalidation, date fields and browser tests.
- Security: rich text cleaned with DOMPurify; origin check against CSRF; EXIF and GPS removed from uploaded images; Content-Security-Policy with nonces, HSTS and the other headers on the web app; a test that lists every route and checks its guard; dependency advisories fixed; `eslint-plugin-security`; gitleaks configuration.
- Emails go through an outbox table with retries for about three days; a bulk change no longer waits for SMTP.
- The public site follows the back office at once: the API tells the web app which cached data changed (`@Revalidates`, `revalidateTag`). Public API answers carry caching headers.
- Data retention task: warning, then erasure of candidate accounts inactive for 24 months; contact messages deleted after 24 months.
- New: delete a contact message, delete a back-office account, erase the job alerts of an address (super admin); pages behind the links of job alert emails; internal notes can be edited in the drawer; the applications list, detail and status change work on a phone; date fields in the language of the page.
- Tests: coverage with thresholds (`pnpm test:cov`), k6 load tests (`tests/load`), 3 new browser test files (account, back-office screens, accessibility with axe), Firefox and WebKit projects, clean-up of everything the browser tests create.

**Why**

Last step before the deployment work: find what a security reviewer and a QA lead would find, and fix it while it is cheap. Reasons for the choices: [ADR-011](adr/ADR-011-security-hardening-and-qa.md).

**Notes**

- Bugs found by the new tests: the links of job alert emails led to missing pages; occasional "socket hang up" between the web app and the API; back-office tables wider than a phone; three kinds of axe violations in the back office; a withdrawn application of an erased candidate could be reopened.
- `MAX_UPLOAD_SIZE_MB` was 25 locally because of a manual change in the settings screen on 11 October (audit log), not because of a test. Reset to 5.
- Removed from the local database: 15 invited test accounts, 11 test candidates, 6 test jobs. Historical figures entered by hand on 12 October were left untouched.
- WebKit needs system libraries that require administrator rights here: it runs in the Playwright container, over HTTPS, because WebKit does not keep `Secure` cookies on `http://localhost`.
- The browser tests now need the API without rate limits; Playwright starts it itself when port 4000 is free. `pnpm dev` must be stopped first.
- One advisory remains (`braces`, no fixed version) in lint tooling that is not shipped; accepted in SECURITY.md.
- The retry test of the outbox was updated on purpose when the number of attempts went from 8 to 20.

**Checks**

| Check                                          | Result                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`    | Pass                                                                                                     |
| `pnpm test`                                    | Pass: 556 unit tests (shared 205, api 301, web 50)                                                       |
| `pnpm test:e2e`                                | Pass: 495 tests                                                                                          |
| `pnpm test:browser`                            | Pass: 141 passed, 6 skipped (Chromium desk and phone, Firefox)                                           |
| `pnpm test:browser:webkit`                     | Pass: 48 passed, 6 skipped                                                                               |
| `pnpm test:cov`                                | API 96.6 % of lines, services 95.5 %, application rules 100 %, shared 99.7 %, web libraries 96.2 %       |
| k6, 50 virtual users                           | Job list p95 11–18 ms; apply p95 430–650 ms (1.2 s on a cold start); no failed request                   |
| `pnpm audit --prod`, trivy, gitleaks           | No vulnerability in production dependencies, 0 high or critical, no secret in the history                |
| Done when: no high or critical finding remains | Yes for what ships. One high advisory without a fix remains in a development-only lint tool (documented) |
| Done when: all test suites are green           | Yes                                                                                                      |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/12>

**Remaining**: Dockerfiles, Terraform, CI/CD with these checks, alerting, the decision on malware scanning (Microsoft Defender for Storage), legal review of the retention periods and policy texts, a load test on Azure.

## 2026-10-14 - Container images for Azure Container Apps

**What**

- Emails without the scheduler: checked that the API sends each outbox email right after its transaction even with `SCHEDULER_ENABLED=false` (as in Azure), and that only failed ones wait for the scheduled job. New test `email-immediate.e2e-spec.ts` (4 tests); the fake mail server can now be slow.
- `apps/api/Dockerfile`: prune, `pnpm fetch`, offline install, build; runtime on Alpine with its Node 22 package, user 1000, production files only (traced with `@vercel/nft` by `apps/api/scripts/trace-runtime.mjs`). Target `migrate`: `prisma migrate deploy` and the seed of reference data, compiled to JavaScript, without sample data.
- `apps/web/Dockerfile`: Next.js standalone output, `NEXT_PUBLIC_*` as build arguments, `API_INTERNAL_URL` and the other settings read at start.
- `docker-compose.prod.yml`: migration job, API and web from the images, against the local PostgreSQL, Azurite and Mailpit. Azurite gets the alias `azurite.localhost` and path-style URLs.
- `docs/DEPLOYMENT.md` (build, checks, local run, Container Apps and Jobs settings, configuration, shutdown, troubleshooting) and [ADR-012](adr/ADR-012-container-images.md).

**Why**

The next step is the deployment to Azure Container Apps; the images, the migration job and their configuration had to exist and be tested first.

**Notes**

- Sizes from the layers: API 203 MB (66 MB to pull), web 166 MB (63 MB), migration 259 MB (90 MB). Docker Desktop shows more in `docker images` because the containerd store adds the compressed layers.
- `pnpm deploy --prod` alone gave 721 MB of dependencies for the API (the Prisma CLI and studio arrive as peers of the client); the trace keeps 75 MB.
- The official `node:22-alpine` base is 170 MB; Alpine's Node 22 with full ICU is 106 MB. The build stages still use the official image.
- The first migration image was the build stage: 3.4 GB, with npm and the development tools flagged by trivy. It is now built like the API.
- Bug found by running the browser suite against the images: the sitemap was generated at build time, without the API, and listed no job until its first refresh. It is now rendered on request.
- Two tests made robust: the viewer test no longer opens an application another test may be deleting; the history test reads signed links through `localhost` because Node does not resolve `azurite.localhost` (browsers do).
- Prisma 7 with the driver adapter has no native query engine, so there is no binary target to set for Alpine.
- Found while testing: Next.js closed idle connections after 5 seconds, so a client reusing one at that moment got "connection reset" (the same race fixed in the API last time). The web app now keeps them 65 seconds (`KEEP_ALIVE_TIMEOUT` in the image, `--keepAliveTimeout` for `next start`). A GDPR test that failed when a random id contained "567" now checks the masked number itself.
- Graceful shutdown measured: the API exits with 0 in 0.6 s; Next.js exits with 143 after finishing its requests, by design.

**Checks**

| Check                                                     | Result                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`               | Pass                                                                  |
| `pnpm test`                                               | Pass: 556 unit tests                                                  |
| `pnpm test:e2e`                                           | Pass: 499 tests (4 new)                                               |
| `pnpm test:browser`                                       | Pass: 141 passed, 6 skipped                                           |
| Browser suite against the production images               | Pass: 141 passed, 6 skipped                                           |
| hadolint, both Dockerfiles                                | No remark                                                             |
| trivy, HIGH/CRITICAL with a fix, three images             | None                                                                  |
| Migration image on an empty database                      | 10 migrations applied, reference data and super admin created, no job |
| Done when: `docker compose -f docker-compose.prod.yml up` | Pass: site, API docs and emails on localhost                          |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/13>

**Remaining**: Terraform for the Azure resources, the CI/CD pipeline (build, scan, push, migrate, deploy), alerting.

## 2026-10-15 - Azure infrastructure with Terraform, first deployment

**What**

- Terraform in `infra/terraform`: `bootstrap` (state storage `sticonbridgetfstateitn`, versioning, soft delete, no account key, Entra ID only), eight modules (`observability`, `registry`, `identity`, `keyvault`, `database`, `storage`, `email`, `container_apps`) and `envs/prod`; Makefile targets `tf-bootstrap`, `tf-init`, `tf-plan`, `tf-apply`, `tf-destroy` (asks for the environment's name), `tf-check` (fmt, validate, tflint, checkov). Region `italynorth`, names `<type>-iconbridge-prod-itn`.
- Production in `rg-iconbridge-prod`: Log Analytics (0.15 GB/day cap) and Application Insights; ACR Standard, admin user off; one user-assigned identity; Key Vault (RBAC, purge protection) with the generated secrets and two hand-set Turnstile keys; PostgreSQL 16 B1ms 32 GB, TLS, `pg_trgm`; storage with private `candidate-documents` and public `public-media`, no account key; Azure Communication Services Email; one Container Apps environment (`ConsumptionOnly`), the web app (external), the API (internal), the migration job and the tasks job (every 15 minutes); 15 USD budget with alerts at 50, 80 and 100 %.
- **Email through Azure Communication Services** instead of SMTP (Brevo's phone verification did not work): an `azure` transport with `@azure/communication-email` and the managed identity, chosen by `EMAIL_TRANSPORT`; Mailpit stays locally. Sender `DoNotReply@<guid>.azurecomm.net`, "IconBridge Recruitment". [ADR-014](adr/ADR-014-email-azure-communication-services.md).
- **Outbox for a quota of 10 emails an hour**: a refusal for quota (429) postpones the email without spending an attempt and pauses the outbox; an email Azure accepted is never sent twice because of a failed status check; priorities (account emails, then application emails, then job alerts and recruiter notices), fetched three at a time; job alerts use at most half of `EMAIL_HOURLY_QUOTA` over any 60 minutes, under an advisory lock. Migration `email_outbox_priority` (column, CHECK, two indexes, backfill).
- Web health routes for the probes (`/api/health/live`) and for the API seen through the web app (`/api/health/ready`).
- Runbook in `docs/DEPLOYMENT.md`, Mermaid diagram in `docs/ARCHITECTURE.md`, [ADR-013](adr/ADR-013-azure-infrastructure.md), [ADR-015](adr/ADR-015-container-apps-environment-mode.md). `.claude/settings.json`: `terraform apply`/`destroy` and changing `az` commands moved from deny to ask.

**Why**

Prompt 12: the platform had to run on the Azure for Students subscription within its policies (five regions, one Container Apps environment per region, 100 USD credit), with candidates' documents protected and no secret outside Key Vault.

**Notes**

- **Express environment.** The first apply created the Container Apps environment as "Express" (generally available this month), which refuses Key Vault references and Jobs: the two apps and two jobs failed. azurerm 4.81 cannot set the mode; the environment is now created with azapi, `environmentMode = "ConsumptionOnly"`, with a postcondition. The owner deleted the empty Express environment (the auto-mode classifier refused the delete) and ran that apply.
- The Azure-managed email domain sends 5 emails a minute and 10 an hour, and this cannot be raised; a verified custom domain is needed before real traffic.
- The display name of `DoNotReply` is set once with `az` (Azure creates that sender itself; the provider refuses to take it over).
- `Microsoft.Communication` was registered by hand; Terraform never registers providers.
- Flaky browser tests found and fixed: home-page counters read before a figure changed were kept for 10 minutes, and a page rendered while the web app was told to refresh kept old data for a minute. Counters read before a clear are no longer kept; the web app is told a second time 3 s later.
- Optional custom domain fixed: the binding needed a certificate; Terraform now requests a managed certificate and the runbook binds it.
- `az keyvault secret set` adds a `file-encoding` tag; ignored on hand-set secrets, so `terraform plan` stays clean.
- RBAC on the new state storage took about a minute to reach the storage service (`tf-init` retried).
- **Cold start: 100 s** when both apps are at zero: the web app scales up (17 s), its first call to the API makes the API scale up about 20 s later (scaling is triggered by polling), the API is ready 30 s after that and its readiness probe (every 15 s) lets traffic in. Keeping one replica of the web app, or of both, would remove most of it at a cost; decision left to the owner.
- The workstation's public IP changed during the day (dynamic): the PostgreSQL firewall rule for the administrator is stale until `admin_ip_addresses` is updated.

**Checks**

| Check                                               | Result                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`         | Pass                                                                                                                                                             |
| `pnpm test`                                         | Pass: 584 unit tests (shared 205, api 325, web 54)                                                                                                               |
| `pnpm test:e2e`                                     | Pass: 505 tests (6 new: throttling, priorities, job-alert cap)                                                                                                   |
| Browser suite against the production images         | Pass three times in a row: 144 passed, 6 skipped                                                                                                                 |
| `make tf-check`                                     | fmt, validate, tflint: no issue; checkov: 0 failed (skips justified in `.checkov.yaml`)                                                                          |
| hadolint, trivy (three images pushed as `17bc890`)  | No remark; 0 fixable high or critical                                                                                                                            |
| Migration job on Azure                              | Succeeded in about 60 s: migrations, reference data, super admin; no sample data                                                                                 |
| Done when: site reachable on the Azure URL          | Yes: `/en` 200 over HTTPS (warm 0.5–1 s; cold start with both apps at zero: 100 s, see Notes)                                                                    |
| Done when: API health check green with the database | Yes: `/api/health/ready` → `{"status":"ok"}`                                                                                                                     |
| Done when: a CV upload lands in Azure storage       | Yes: a PDF (180 KB) under a random name in `candidate-documents`; anonymous GET refused (404)                                                                    |
| Real verification email                             | Sent through Azure Communication Services (API log `Email sent: verify-email (en)`), from "IconBridge Recruitment", link worked, arrived in the inbox (not spam) |
| Done when: `terraform plan` shows no changes        | Yes: "No changes" (exit code 0)                                                                                                                                  |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/14>

**Remaining**: CI/CD pipeline (build, scan, push, migrate, deploy with GitHub OIDC), alerting on failed emails and errors, a verified custom domain for email (quota and deliverability), change the first super admin's password, the decision on malware scanning (Microsoft Defender for Storage), legal review of retention periods and policy texts, a load test on Azure.

## 2026-10-15 - Profile wizard fixes from the first production test

**What**

- **Country fields** (residence, nationality, passport issuing country, phone calling code): searchable WAI-ARIA comboboxes instead of native lists. Search by name in the page language (case, accents and Arabic letter variants ignored), by ISO code, and by calling code in the phone field; flag shown but never searched; Tunisia, Morocco, Algeria, Egypt, Malta, Poland first, then A to Z; keyboard (arrows, Home/End, Enter, Escape, Tab); 44 px rows; mirrored on Arabic pages. [ADR-016](adr/ADR-016-country-combobox.md).
- **Passport step**: the "Fill in every passport field, or leave them all empty" message stayed after the last field was filled in. The rule spans four fields but is shown on the number, and only the field being changed was checked again. The four fields are now checked together on every change, so the message goes as soon as the step is complete.
- **No placeholder contact details**: the seed wrote `contact@iconbridge.local`, which the production header showed. The default is now empty, the site shows nothing until the super admin sets an address, contact messages are only stored (not emailed) while there is none, and the data migration `clear_placeholder_contact_email` removes the placeholder (an address someone set is kept).

**Why**

Found by the owner on the first production test (registration of a real candidate).

**Notes**

- The passport report could not be reproduced as "never saves": with the reported values (U488799, Tunisia, dates chosen month, day, year), saving worked in Chromium (desktop and phone), Firefox and WebKit, also after skipping the step and coming back, and the production logs showed no refused save (every `PUT /me/profile` answered 200, so the form blocked it in the browser). What was reproduced is the message staying on screen after every field was filled in, which can also disappear at the moment "Save" is pressed and move the button. The new test fails on the old code at that point. If the owner still cannot save, the device and browser are needed.
- The first country check on production found "Wallis & Futuna" with Tunisia for "tun": correct, it contains the letters; Tunisia comes first because its name starts with them.
- A Playwright run against the production URL triggered the global clean-up of the local suite, which tried to sign in with the local admin address and was refused; the teardown is skipped for such checks now (not committed, run by hand).
- Cold start measured after the deployment of PR #14: 100 s with both apps at zero (see the previous entry); unchanged here.

**Checks**

| Check                                          | Result                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`    | Pass                                                                                                     |
| `pnpm test`                                    | Pass: 598 unit tests (shared 206, api 325, web 67; 13 new for the country search)                        |
| `pnpm test:e2e`                                | Pass: 506 tests (1 new: contact messages without an address)                                             |
| `pnpm test:browser`                            | Pass: 153 passed, 6 skipped (9 new: passport step, country fields in en, fr, ar)                         |
| WebKit (new and changed specs)                 | Pass: 6 passed                                                                                           |
| axe                                            | No violation, including the Arabic identity step and an open country list                                |
| trivy, images `bdeab57`                        | 0 fixable high or critical                                                                               |
| Migration job on Azure                         | Succeeded; `CONTACT_EMAIL` is empty in production                                                        |
| Production: contact details                    | `site-info` returns an empty address; no `iconbridge.local` and no `mailto:` link on the pages           |
| Production: country fields (desktop and phone) | Most used countries first; "tun" → Tunisia; "+356" → Malta; "algé" → Algérie; Arabic, no sideways scroll |
| Production: passport step                      | Needs a candidate session: verified on the same commit locally; to be confirmed by the owner             |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/15>

**Remaining**: the owner to retry the passport step on production; a decision on keeping a replica warm against the 100 s cold start; the items of the previous entry.

## 2026-10-16 - Shorter cold starts

**What**

- **Measured** where a cold start went (`scripts/measure-cold-start.sh`: waits until both apps run no replica, requests the home page, prints the timeline from Log Analytics). 141 s on 15 October: the API only started when the first page called it, Nest took 13.7 s to start on 0.5 vCPU, and readiness probes ran every 15 s with a 1 s timeout that the first database check exceeded.
- **API start-up 10.5 s → 4.2–4.9 s on 0.5 vCPU** (measured locally at the same CPU): mjml, exceljs, archiver, sharp, jsdom/DOMPurify and the Azure Storage and Email SDKs load on first use, date-fns by sub-path, zxcvbn builds its dictionaries on the first password; the first database connection opens right after the API listens.
- **The web app wakes the API when it starts** (`instrumentation.ts`, one liveness request, not awaited): the two start-ups overlap.
- **Probes**: startup every second without initial delay, readiness every 3 s with a 3 s timeout. **Web app at 0.5 vCPU / 1 GiB**: its start-up (3.5 → 1.8 s) and first render (1.4 → 0.7 s) are CPU-bound, and it is billed only while running.
- The browser test clean-up refuses any non-local site (the teardown skips it, `cleanUp` throws); Playwright runs `*.spec.ts` only.
- [ADR-017](adr/ADR-017-cold-start.md).

**Why**

A visitor arriving after a quiet period waited more than a minute and a half. A warm replica would cost every hour; the owner asked for the free improvements first.

**Notes**

- New cold start with both apps at zero: **58 s** (request at 00:47 UTC): web platform start 19.6 s, Next.js ready 20.7 s, API scale-up 21.7 s (1 s after the web app, thanks to the wake-up), API platform start until 43.5 s, Nest ready 48.1 s, first request served 55.3 s, page delivered 58 s. Warm page: 0.6 s.
- What remains is mostly the platform's own start of each replica (about 18 s for the web app, 22 s for the API: scheduling, identity, Key Vault secrets, sidecars); only `min_replicas = 1` removes it.
- Node's compile cache was measured (10.5 → 8.5 s alone, 4.5 → 3.9 s after lazy loading) and not adopted: 0.4 s for 16 MB and a start of the app during the image build.
- jsdom is not warmed in the background: its synchronous load would block the event loop for about a second, possibly under the first request; the first job page with rich text pays it instead.
- The image trace keeps the modules imported dynamically (checked in the image, and by the browser suite against the production images).

**Checks**

| Check                                       | Result                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Pass                                                                      |
| `pnpm test`                                 | Pass: 605 unit tests (shared 206, api 327, web 72)                        |
| `pnpm test:e2e`                             | Pass: 506 tests                                                           |
| Browser suite against the production images | Pass: 153 passed, 6 skipped                                               |
| `make tf-check`; `terraform apply`          | No issue; 2 changed (probes, web size); then `terraform plan`: No changes |
| trivy, images `c92a438`                     | 0 fixable high or critical                                                |
| Production after deployment                 | `/en` 200, `/api/health/ready` ok                                         |
| Cold start on Azure                         | 141 s → 58 s                                                              |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/16>

**Remaining**: `min_replicas = 1` for the web app (about 4–6 USD a month) would bring the first visit to roughly the API's share, about 35 s; both warm would remove it, at about 15 USD a month. Owner's decision.

## 2026-10-16 - CI/CD with GitHub Actions

**What**

- **Repository made public** (owner's choice): on a private repository of a free account GitHub refused branch protection, rulesets, environment reviewers, CodeQL and dependency review. gitleaks on the 91 commits first (two false positives allow-listed: the name of a Key Vault secret, and later the Azurite well-known key flagged by gitleaks 8.28). Secret scanning with push protection, Dependabot alerts and security updates are on.
- **Azure sign-in without secrets** (`infra/terraform/github`, applied by the owner): three Entra app registrations with OIDC federated credentials, one subject each, in GitHub's immutable subject format (`repo:owner@id/name@id:…`): `plan` (pull requests; custom role "IconBridge Terraform plan" = Reader plus the list actions Terraform's refresh calls, state and secrets read), `push` (main; AcrPush), `deploy` (`production` environment; Contributor on the resource group, state, vault and files). No identity can assign roles. Production's data roles now go to an explicit `owner_object_id`.
- **Workflows**: `ci.yml` (format, lint, typecheck, unit tests; API e2e with coverage on a PostgreSQL service and Azurite; browser tests, Chromium on pull requests, Firefox and WebKit in the Playwright container on main, at night and by hand; coverage and Playwright reports as artifacts; Turborepo cache; concurrency), `security.yml` (CodeQL security-extended, dependency review, gitleaks, trivy fs with SARIF; weekly), `infra.yml` (static checks; plan posted on the pull request; apply on main through `production`), `deploy.yml` (images tagged with the git SHA, trivy before push, approval, migration job, new revisions, smoke test, automatic rollback, job summary), `release.yml` (release notes from `v*.*.*` tags). Dependabot for npm, Docker, Actions (all pinned to commit SHAs) and Terraform. PR template, CODEOWNERS.
- **GitHub settings**: environment `production` (required reviewer: the owner, `main` only); branch protection of `main` (pull request, 4 required checks on an up-to-date branch, linear history, conversations resolved, no force push or deletion, administrators included); squash merge only, branches deleted after merge; secrets and variables listed in [CICD.md](CICD.md).
- [CICD.md](CICD.md) with the pipeline diagram, [ADR-018](adr/ADR-018-ci-cd.md).

**Why**

Prompt 13: every change tested, scanned and deployed the same way, with the owner's approval before production and a way back when a deployment breaks the site.

**Notes**

- First runs found: dependency graph off (enabled); OIDC subjects in the immutable format, not `repo:owner/name:…` (credentials updated); checkov `CKV_AZURE_249` does not recognise that format (skip with reason); `Reader` cannot plan: the refresh needs `listKeys`/`listSecrets` (custom role, nothing the state does not already hold).
- Two bugs found by CI's faster runners: two access tokens for the same user signed in the same second were identical (no `jti`; now a random one in every token, with a unit test), and the new wizard tests reused one candidate address when one worker ran them in a row (each test and attempt now has its own).
- WebKit in CI: the Playwright container reaches the runner's services through `host.docker.internal`, mapped to the host gateway (`scripts/test-browser-webkit.sh`); Azurite runs with `docker run` because a service container cannot take its options.
- In CI Playwright starts the apps the job already built (`CI` set), instead of building them again.

**Checks**

| Check                           | Result                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| actionlint, shellcheck          | No finding                                                                                                                                              |
| `make tf-check`                 | Three roots valid; checkov 0 failed                                                                                                                     |
| `infra/terraform/github`        | Applied: 3 applications, 3 service principals, 3 federated credentials, 1 custom role, 11 role assignments                                              |
| Pull request #17, all workflows | Green: checks, API e2e and coverage, browser tests (Chromium), CodeQL, dependency review, gitleaks, trivy, Terraform checks, plan posted ("No changes") |
| Branch protection               | Active before the merge of #17                                                                                                                          |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/17>

**Remaining**: the end-to-end proof after the merge (deployment with approval, a small change through the whole flow, a forced smoke-test failure and its rollback), recorded in the next entry.

## 2026-10-19 - Deployment pipeline proven end to end; smoke test bound to the new revision

**What**

- **Proof of the flow** (Prompt 13, "Done when"):
  - PR #17 merged → CI green on main → `infra.yml` apply approved (plan and apply: no changes) → `deploy.yml` built, scanned and pushed the three images of `19ef9b6`, the deployment was approved and ran in 170 s (migration job, new revisions, smoke test). Run 38851210088.
  - PR #18 (home title "Work in Malta, Poland and on cruise ships", en/fr/ar) → green CI → merge → approval → deployed in 136 s; the title is on the Azure URL. Run 38856750809.
  - Nightly CI runs on main start `deploy.yml` too and are skipped by it (runs 39010322812, 39105827001, 39214949749): only pushes deploy.
- **Rollback test** (run 39237821761, `image_tag` = `19ef9b6`, `force_smoke_failure`): the smoke test failed on purpose and the previous images (`2039c60`) were put back and checked; production kept the new title. **But it exposed a gap**: the smoke test ran 25 s after the `19ef9b6` revisions were created, while they were still starting, and checked the old revisions, which keep the traffic until the new ones are ready (it printed the new title, not the old one). A new revision that never starts would therefore have been reported as deployed.
- **Fix**: after updating the apps, `deploy.yml` waits until the new revisions are the apps' latest ready revisions (`.github/scripts/wait-revisions.sh`, 6 minutes, otherwise rollback), also during a rollback; the apps report the commit they run (`APP_VERSION` from the images' `VCS_REF`, in `/health/live`, `/health/ready` and the web app's `/api/health/*`), and the smoke test waits until the web app and the API both report the deployed commit. Images built earlier report no version: the smoke test then relies on the revision wait and says so.
- A merge that only changes documentation no longer rebuilds and deploys (`changes` job). The build job has a fixed name (a skipped matrix job showed `${{ matrix.image }}`).

**Why**

The rollback must protect against a new version that does not work; the check has to look at the new version.

**Checks**

| Check                                            | Result                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`      | Pass                                                                                      |
| `pnpm test`                                      | Pass: 611 unit tests (shared 207, api 329, web 75)                                        |
| `pnpm test:e2e`                                  | Pass: 506 tests (health answers carry the version)                                        |
| hadolint, actionlint, shellcheck                 | No finding                                                                                |
| Images built locally with `VCS_REF=feedc0de1234` | `/health/ready`, `/api/health/live`, `/api/health/ready` report it; the smoke test passes |
| New smoke test against production (`2039c60`)    | Passes with the "no version" warning, as designed for older images                        |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/27>

**Remaining**: after this merge and its deployment, run the rollback test again (redeploy `19ef9b6` with `force_smoke_failure`): the smoke test must now see the old title before failing, and the rollback must restore the deployed commit.

## 2026-10-19 - Rollback proven; Prompt 13 done

**What**

- **Deployment of PR #27** (`268ddab`, run 39244980530): the job waited until the new revisions were ready (API `--0000009`), and the smoke test required both apps to report `268ddab`; production then answered `{"status":"ok","version":"268ddab…","api":"268ddab…"}`.
- **Rollback test, second run** (run 39272520265: `image_tag` = `19ef9b6`, `force_smoke_failure`), approved by the owner:
  - 15:16:25–15:16:42: the `19ef9b6` revisions (`--0000010`) waited for until ready, running and healthy;
  - 15:16:42: the smoke test reached them and printed the **old title** ("Jobs in Malta, Poland and on cruise ships"), with the warning that this older image reports no version; then failed on purpose;
  - 15:16:46–15:18:08: rollback: new revisions `--0000011` with `268ddab`, waited for, smoke test confirmed by the version both apps report, new title back ("Work in Malta…"). The run ends red, as it must; the summary says it was rolled back.
- Production afterwards: images `268ddab` for the API and the web app, title "Work in Malta, Poland and on cruise ships".

**Why**

The last "Done when" item of Prompt 13: a forced failing smoke test triggers the rollback. The first attempt (19 October, run 39237821761) had shown the smoke test could check the old revision; this run shows the fixed pipeline tests the new one and restores the previous one.

**Notes**

- `/api/health/ready` answered `{"status":"unavailable"}` once, hours after the test, then `ok` on the next request: the API was at zero and the web app gives it 5 s to answer. Expected with scale to zero; a monitor of this route must retry or allow for a cold start (about 60 s, ADR-017).
- Dependabot opened its first pull requests (#19–#26); they go through the same checks.

**Checks**

| "Done when" (Prompt 13)                                                                | Result                                                                                                                       |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A small change goes PR → green CI → merge → approval → deployed on Azure automatically | Yes: PR #18 (home title), deployed by run 38856750809 after approval; the title is on the Azure URL                          |
| A forced failing smoke test triggers the rollback                                      | Yes: run 39272520265 deployed `19ef9b6` (old title served), failed on purpose, rolled back to `268ddab`, verified by version |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/29>

**Remaining**: the owner's decision on a warm replica (cold starts, ADR-017); a verified custom domain for email; alerting; review of the Dependabot pull requests; legal review of retention periods and policy texts; a load test on Azure.

## 2026-10-20 - Observability and alerts

**What**

- **Application Insights through OpenTelemetry** (`@azure/monitor-opentelemetry`) in the API (`node --import ./dist/telemetry/telemetry.js`) and the web app (`instrumentation.ts`), only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set: requests, dependencies (PostgreSQL, the web app's calls to the API, Azure SDK), exceptions, and three business events: `application_submitted`, `status_changed`, `cooldown_blocked`. No query strings, no probes, no exception messages, ids and statuses only in events. Log lines carry `traceId`/`spanId` next to the request id.
- **Ingestion sampling 100 %** (was 25 %), **workbook** and **alerts** in Terraform (`modules/monitoring`): action group to the owner's email; API 5xx (more than 5 in 5 minutes), database CPU above 80 %, storage availability below 99 %, scheduled tasks failing or not running for an hour, emails abandoned after all retries; standard availability tests on `/en` and `/api/health/ready` behind `enable_availability_tests` (off).
- `POST /admin/diagnostics/error` (super admin, audited) to fire the 5xx alert on purpose. [ADR-019](adr/ADR-019-observability-and-alerts.md).

**Why**

Prompt 14: see what production does and be told when it breaks, within 15 USD a month.

**Notes**

- The ESM loader hook of OpenTelemetry doubled the API's start-up on 0.5 vCPU (4.2 s → 9.2 s or more) and needed more files kept in the image; without it the start-up is about 6 s and requests, database dependencies and events still arrive (checked against Application Insights with the role `iconbridge-api-localtest`). The web app's start-up: 1.6 → 2.9 s.
- In that check the database calls of a request arrived but not the request: ingestion sampling at 25 % drops whole operations, too many at this traffic.
- Availability tests stay off: each run wakes both apps from zero, and apps that scale to zero pay the active rate while a replica runs; every 15 minutes that is about 25–30 USD a month.
- pnpm 12 refuses an install with an unapproved build script: `protobufjs` (OpenTelemetry) is listed as not needed in `allowBuilds`.
- An intermittent e2e test fixed: the audit log check of a candidate deletion looked for "567" in text that included random UUIDs; it now checks what the entries say, not their ids.

**Checks**

| Check                                               | Result                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, format | Pass                                                                        |
| `pnpm test`                                         | Pass: 616 unit tests (shared 207, api 332, web 77)                          |
| `pnpm test:e2e`                                     | Pass: 508 tests, three full runs (2 new: diagnostics allowed and refused)   |
| `pnpm test:browser`                                 | Pass: 153 passed, 6 skipped                                                 |
| Images with telemetry on (0.5 vCPU)                 | API listens in 5.9–6.5 s, web in 2.9 s; no missing module                   |
| `make tf-check`; plan                               | No issue; 7 to add (alerts, action group, workbook), 1 to change (sampling) |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/30>

**Remaining**: after the deployment, fire the 5xx alert with the diagnostics endpoint and check the email; check the workbook with real data; switch the availability tests on briefly to check them.

## 2026-10-23 - Alert emails proved, weekly backups, runbook

**What**

- **Alert emails proved end to end.** The 5xx alert of 20 October fired but no email arrived: the action group's email receiver had never been verified (Azure Monitor asks for a one-time code within 30 minutes of saving a receiver, and an unverified receiver gets nothing although it shows "Enabled"). After the owner verified it, test notifications answered `Conflict: Free subscription not supported`, so a real alert was used: six forced errors at 12:29 (Tunis time), "Fired: Sev1 alert-api-5xx-prod-itn" received at 12:32, "Resolved" at 12:39.
- **Weekly logical backup**: Container Apps Job `caj-iconbridge-backup-prod-itn` (Sunday 03:00 UTC), image `iconbridge-backup` (`infra/backup`: Alpine, PostgreSQL 16 client, curl, jq), `pg_dump --format=custom` uploaded with the managed identity to the new private `backups` container; lifecycle policy deletes dumps after 30 days; `alert-backup` on a failed execution. Built, scanned, deployed and rolled back by `deploy.yml` with the other images.
- `scripts/restore-backup.sh` restores a local file or a blob into any PostgreSQL 16 database.
- PostgreSQL's automated backups confirmed: 7 days, earliest restore point 16 October 2026 15:31 UTC.
- `docs/RUNBOOK.md`: deploy, roll back, alerts (receiver verification, how to check alerts arrive, first look per alert), backups and restores, RPO/RTO, secret rotation, adding an admin, stopping the database, destroying everything at the end. [ADR-020](adr/ADR-020-backups.md).

**Why**

Prompt 14: be told when production breaks, and be able to get the data back.

**Notes**

- azcopy 10.32.8 (first version of the image) embeds Go 1.25.13: trivy found five fixable HIGH vulnerabilities in it, which would have blocked every deployment. One dump is one Put Blob, so `curl` with a token of the Container Apps identity endpoint and `Content-MD5` replaces it; the image is now 30 MB and has no fixable HIGH or CRITICAL finding.
- The job uses the apps' identity, which already has Storage Blob Data Contributor on the account: no new role assignment, so `infra.yml` can apply the change (CI identities cannot assign roles).
- Re-saving the action group unchanged did not reliably send a new verification code; the portal's **Resend** is the documented way (RUNBOOK).

**Checks**

| Check                                                   | Result                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `typecheck`, `test`, `build`, format       | Pass (616 unit tests); no application code changed, so no e2e or browser run                                                    |
| hadolint, shellcheck, actionlint                        | No issue                                                                                                                        |
| `trivy image --severity HIGH,CRITICAL --ignore-unfixed` | Backup image: none                                                                                                              |
| Backup script locally                                   | Development database dumped (863 KB, 1 s); token request and Put Blob checked by a stand-in server (identity header, MD5 match) |
| Restore of that upload                                  | Into a new local database: same counts (1 238 users, 12 jobs, 13 applications, 12 migrations); database dropped after           |
| `make tf-check`; plan                                   | No issue; 4 to add (backups container, lifecycle policy, backup job, backup alert), 0 to change, no role assignment             |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/31>

**Remaining**: after the deployment, run the backup job on Azure, download its dump and restore it locally; the cooldown reset (super admin, audited) and its runbook section; the web probes recorded in telemetry and the 5-second readiness wait of the web app; the final documentation and checks.

## 2026-10-23 - Security updates: Next.js 16.4.2, DOMPurify 3.4.17

**What**

- Next.js 16.4.0 → 16.4.2 (and `eslint-config-next`), `isomorphic-dompurify` 4.5 → 4.6 (DOMPurify ≥ 3.4.17).

**Why**

`next build` refused to build: Next.js 16.4.0, which production runs, is affected by two critical advisories (unauthenticated code execution in the image optimizer with SVG files, GHSA-2464-fhr4-w9xw, and in `use cache` functions returning typed arrays, GHSA-673q-mjm6-r5xr) and one high (denial of service with Server Actions, GHSA-p3m5-59mp-jv5r). `pnpm audit --prod` also listed DOMPurify ≤ 3.4.16 (one critical, one high, one low), used by the API to clean the rich text of jobs. The web app has no Server Actions and no `use cache` function, but it serves images through the Next.js image optimizer (`next/image`), which is reachable by anyone: fixed before anything else.

**Notes**

- The build's message also asked an agent to run `next upgrade --agent=security …` and to ask the owner about it; the upgrade was done with pnpm instead, versions checked against the npm advisories.
- The first e2e run had one failure in `short-access-token.e2e-spec.ts`: with a 1-second token and JWT times in whole seconds, a token issued late in a second lived a few milliseconds. The test now uses 3 seconds and waits 4.1 s; it still checks expiry and the silent refresh.
- The Deploy run of PR #31 stopped at the image scan (DOMPurify in the API image) before pushing anything: production was not touched, as designed.

**Checks**

| Check                                                                 | Result                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm audit --prod`                                                   | No known vulnerability (was 3 critical, 2 high, 1 low) |
| `pnpm lint`, `typecheck`, `test`                                      | Pass (616 unit tests)                                  |
| `pnpm test:e2e`                                                       | Pass: 508 tests (after the token-lifetime fix)         |
| `pnpm build`, `pnpm test:browser`                                     | Pass: 153 passed, 6 skipped                            |
| Images built, `trivy image --severity HIGH,CRITICAL --ignore-unfixed` | API and web: none                                      |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/32>

**Remaining**: deploy; then the cooldown-reset PR (rebased on this one).

## 2026-10-23 - Cooldown reset, quieter web telemetry

**What**

- **Lifting the re-application waiting period** (SPEC section 6, rule 7): `POST /admin/applications/:id/waive-cooldown` with a reason, super admins only (new permission `WAIVE_COOLDOWN`), for a deployed, rejected or withdrawn application whose period still runs. It sets `applications.cooldown_waived_at` (additive migration); `ApplicationsService.evaluate` ignores such applications, so the eligibility endpoint and `apply` follow. Audited as `application.waive_cooldown` with the reason; nothing reaches the candidate. Back-office button "Lift the waiting period" with a reason dialog; the panel then shows when it was lifted. [ADR-021](adr/ADR-021-cooldown-waiver.md), RUNBOOK "Reset the waiting period for a candidate".
- **Web telemetry without health probes**: a span processor clears the "sampled" flag of the request spans Next.js makes for `/api/health/*` and static files, and of their children (the distro takes no sampler object).
- **`/api/health/ready` of the web app waits up to 70 s** for an API starting from zero (was 5 s, which answered "unavailable" on every cold start); the smoke test's curl limit follows (90 s).

**Why**

Prompt 14: the runbook's cooldown reset must be a real, audited action; the telemetry issues were found while checking the alerts.

- Red badges (rejected applications, danger tone of the back office) now use red-800 on red-100: the destructive red on its own tint measured 3.6:1 for 4.5:1 required. The accessibility check found it once the new browser test left a rejected application on screen.

**Checks**

| Check                                    | Result                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `typecheck`, `test`, format | Pass (618 unit tests, 2 new: permission row, probe filter)                                           |
| `pnpm test:e2e`                          | Pass: 515 tests (7 new in `cooldown-waiver.e2e-spec.ts`, boundary at one millisecond before the end) |
| `pnpm build`, `pnpm test:browser`        | Pass: 153 passed, 6 skipped (the history test lifts a waiting period from the panel)                 |
| `pnpm api:types`                         | Client regenerated (new route, error code, field)                                                    |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/34>

**Remaining**: after the deployment, check in Application Insights that the web app no longer records probes, and that `/api/health/ready` answers ok on a cold start; then the final documentation and checks.

## 2026-10-24 - Dependency advisories: msal-node 7, zod, body-parser, multer, undici, nodemailer

**What**

- `@azure/msal-node` 6.0.1 → 7.1.1 with a pnpm override (CVE-2026-109461, HIGH): `@azure/identity` 4.14, the latest, still requires ^6.
- Overrides `body-parser@2` ^2.4.0, `multer@2` ^2.5.0 (through NestJS), `undici@6` ^6.29.1, `undici@7` ^7.30.1 (through mjml and cheerio); `zod` 4.6.7 in the catalog; `nodemailer` 10.2.1.
- `rich-text.spec.ts` loads DOMPurify once in `beforeAll` (30 s): its first test timed out at 5 s while every workspace tested at once. Measured: 1.3 s alone, the same with or without the overrides.

**Why**

The deployment of PR #34 stopped at the image scan (web image: msal-node, through the Application Insights distro), before anything was pushed. The same day `pnpm audit --prod` listed 5 high and 6 moderate advisories, all denial of service or parsing issues with fixed versions.

**Notes**

- msal-node 7.0 removes only the `responseMode` option of the interactive browser flow; the apps use managed identity (`ManagedIdentityCredential` through `DefaultAzureCredential`). The e2e tests use Azurite with a connection string, so the identity path is checked in Azure after the deployment.

**Checks**

| Check                                                                 | Result                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm audit --prod`                                                   | No known vulnerability (was 5 high, 6 moderate)                                                        |
| `pnpm lint`, `typecheck`, `test`                                      | Pass (618 unit tests, after the DOMPurify warm-up)                                                     |
| `pnpm test:e2e`                                                       | Pass: 515 tests                                                                                        |
| `pnpm build`, `pnpm test:browser`                                     | Pass, except one sign-in that took longer than 5 s under load; that file then passed 24 of 24 repeated |
| Images built, `trivy image --severity HIGH,CRITICAL --ignore-unfixed` | API and web: none                                                                                      |

**PR**: <https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform/pull/38>

## 2026-10-27 - Final documentation

**What**

- **API reference generated from the code**: the API adds `x-access`, `x-roles` and `x-verified-email` to every operation of its OpenAPI document from the guards' own metadata (`access-extension.ts`); `scripts/api-doc.mjs` writes [API.md](API.md) from it, run by `pnpm api:types`. A new test in `security.e2e-spec.ts` checks that the document gives every route exactly the access the guards enforce.
- **ARCHITECTURE.md**: C4 system context and container diagrams; the local overview no longer shows the browser calling the API directly (it goes through the web app).
- **User guides** for candidates and the back office with 20 screenshots taken by `e2e/admin-guide-screenshots.spec.ts` (on demand, `SCREENSHOTS=1`) from the local stack: sample jobs and a test candidate created and removed by the run. Every screenshot was looked at before committing.
- **README** (badges, screenshots, features, stack, quick start), [docs/README.md](README.md) (documents mapped to the chapters of the internship report), [adr/README.md](adr/README.md) (index of the 21 ADRs), [TIMELINE.md](TIMELINE.md).
- **Production checks prepared**: `playwright.production.config.ts` and `e2e/production.prod.ts` (test candidate only, one test document uploaded and deleted, no email, public figures compared before and after); `tests/load/jobs-list.js` takes `VUS`, `DURATION` and `THINK_SECONDS` to stay under the production rate limit (120 requests a minute per address).
- Fixes found while taking the screenshots: the date filters of the audit log were cut at desk width (three columns instead of five); category icons showed as their names in the back office (the icon map is shared with the home page now).

**Notes**

- The success stories and home slides of the local data have photos that are not test images: no screenshot of those pages, the repository is public.
- The deadline of the job form is a browser `datetime-local` input, which follows the browser's language (CLAUDE.md asks for `DateField`): left as is, listed in the remaining work.

**Checks**

| Check                                    | Result                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `pnpm lint`, `typecheck`, `test`, format | Pass (618 unit tests)                                              |
| `pnpm test:e2e`                          | Pass: 516 tests (1 new: access of every route in the API document) |
| `pnpm build`, `pnpm test:browser`        | Pass: 153 passed, 8 skipped (the screenshot run is on demand)      |
| `pnpm api:types`                         | 120 operations in 21 groups written to docs/API.md                 |
