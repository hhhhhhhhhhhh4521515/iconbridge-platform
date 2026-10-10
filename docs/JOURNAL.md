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
