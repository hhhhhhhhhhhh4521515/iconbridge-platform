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
