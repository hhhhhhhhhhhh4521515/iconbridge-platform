# IconBridge Jobs

Recruitment platform where candidates apply for jobs in Malta, Poland and on cruise ships. Candidates register, build a profile, upload documents and apply; recruiters manage job offers and move applications through a visa pipeline. Hosted on Azure (Container Apps, PostgreSQL Flexible Server, Blob Storage) with Terraform and GitHub Actions.

**Always read [docs/SPEC.md](docs/SPEC.md) before starting a feature.** Follow the region, quotas, budget and CI/CD identity recorded in [docs/00-environment.md](docs/00-environment.md).

## Folder map

| Path                 | Content                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js App Router, Tailwind CSS, shadcn/ui. Port 3000                                                                           |
| `apps/api`           | NestJS REST API (ESM), Prisma. Port 4000, prefix `/api/v1`, Swagger at `/api/docs`, probes at `/health/live` and `/health/ready` |
| `packages/shared`    | zod schemas, enums (roles, application statuses, destinations) and types used by web and api                                     |
| `packages/config`    | Shared ESLint, Prettier and tsconfig presets                                                                                     |
| `infra/terraform`    | Azure infrastructure (empty for now)                                                                                             |
| `.github/workflows`  | CI/CD (empty for now)                                                                                                            |
| `docs/`              | `SPEC.md`, `ARCHITECTURE.md`, `JOURNAL.md`, `00-environment.md`, `adr/`                                                          |
| `docker-compose.yml` | Local PostgreSQL 16, Azurite, Mailpit, optional pgAdmin (profile `tools`)                                                        |

## Commands

Run from the repository root, inside WSL (`~/projects/iconbridge-platform`, never OneDrive).

| Command                                   | Effect                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm env:init`                           | Create missing `.env` files from the `.env.example` files                                                     |
| `pnpm dev`                                | Start the compose services, wait until healthy, then run web, api and shared in watch mode                    |
| `pnpm build`                              | Build every workspace                                                                                         |
| `pnpm test`                               | Unit tests of every workspace (Vitest, no database needed)                                                    |
| `pnpm test:e2e`                           | API end-to-end tests over HTTP against the PostgreSQL test database `iconbridge_test` (needs `pnpm infra:up`) |
| `pnpm lint`                               | ESLint in every workspace                                                                                     |
| `pnpm typecheck`                          | `tsc --noEmit` in every workspace                                                                             |
| `pnpm format`                             | Prettier on the whole repository                                                                              |
| `pnpm db:migrate`                         | `prisma migrate dev` (create and apply migrations locally), then regenerate the client                        |
| `pnpm db:seed`                            | Run `apps/api/prisma/seed.ts`: reference data and super admin; sample data in development. Safe to run again  |
| `pnpm --filter @iconbridge/api db:studio` | Prisma Studio on <http://localhost:5555>                                                                      |
| `pnpm infra:up` / `pnpm infra:down`       | Start / stop the compose services only                                                                        |

One workspace: `pnpm --filter @iconbridge/api test`. Local URLs: web <http://localhost:3000>, Swagger <http://localhost:4000/api/docs>, Mailpit <http://localhost:8025> (SMTP on 2525), Azurite blob `localhost:10000`.

## Coding conventions

- TypeScript strict everywhere. No `any` (ESLint error); use `unknown` and narrow.
- Validate with zod at every boundary: HTTP input, environment variables, external responses. Schemas used by both apps live in `packages/shared`; derive types with `z.infer`.
- `apps/api` and `packages/shared` are ESM: relative imports end in `.js`.
- Business rules (re-application cooldown, job availability, status transitions, passport checks) must have tests. Enforce them in the API, not only in the UI.
- API endpoints: every route requires a session unless it is `@Public()`. Restrict with `@Roles(...PERMISSIONS.X)` from `packages/shared`; back-office routes go under `admin/` and must have `@Roles`. Candidate-owned records use `OwnershipGuard` with `@Owned()`. Applying to a job needs `@RequireVerifiedEmail()`.
- Validate input with `ZodBody` / `ZodQuery` / `ZodParams` and a schema from `packages/shared`; document it with `ApiZodBody`. Throw `AppException` with a code from `API_ERROR_CODES`.
- Admin writes: add `@Audit({ action, entityType, idParam })` and a loader in `AuditSnapshotService` for new entity types.
- Emails: add the template in English, French and Arabic in `apps/api/src/mail/mail.templates.ts`.
- New endpoints need e2e tests for the allowed and the refused roles.
- Database: follow the conventions in the "Data model" section of `docs/ARCHITECTURE.md`. Create migrations with `--create-only` when they need hand-written SQL (CHECK constraints, generated columns), and list new constraints in that section. Never edit a migration that has been merged.
- An enum that exists in both `schema.prisma` and `packages/shared` must be changed in both; `apps/api/src/prisma/enums.spec.ts` checks it.
- New environment variable: add it to the zod schema and to the matching `.env.example`, with a comment.
- shadcn/ui components are added with `pnpm dlx shadcn@latest add <name>` from `apps/web`.
- Versions shared by workspaces are set in the `catalog` of `pnpm-workspace.yaml`.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`); commitlint checks them. Small logical commits.
- Feature branches named `feat/<task-name>`; never commit directly to `main`.
- Record important technical choices as ADRs in `docs/adr/ADR-NNN-title.md`.

## Security rules

- Never commit secrets. `.env` files and `.azure-context` are git-ignored; only `.env.example` files with non-secret local values are committed.
- Never log personal data: passport numbers, dates of birth, phone numbers, email addresses, document contents, tokens, passwords. Log ids instead.
- Passport numbers are written only through `protectPassportNumber` (`apps/api/src/common/crypto/passport.ts`): encrypted column plus masked column. Lists, snapshots, exports and audit entries use the masked value.
- Tokens (refresh, email) are stored as SHA-256 hashes; passwords as argon2id hashes.
- Never reveal whether an email has an account (register, login, forgot password, resend verification answer the same).
- Auth cookies stay `HttpOnly`, `Secure`, `SameSite=Lax`. Add new sensitive field names to `SENSITIVE_KEYS` in `apps/api/src/common/logging/logger.config.ts`.
- Error messages about configuration name the variable, never its value.
- Candidate files are private: serve them through short-lived SAS links, never public containers.
- Internal notes are never returned to candidates.

## Autonomous workflow (mandatory after every task)

a) Create a branch `feat/<task-name>` from an up-to-date `main` before starting.

b) When the work is done, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` and `pnpm build`; start the stack and verify every "Done when" item of the prompt yourself (curl the endpoints, run Playwright, read Mailpit through its API, query the database). Never mark something done without running it.

c) If a check fails, fix the cause and re-run (never skip, disable or weaken a test to make it pass). After 3 failed attempts on the same problem, stop and report BLOCKED with the error and your hypotheses.

d) Commit in small logical commits with conventional messages, push, open a PR with `gh` (summary + checks run), wait for CI with `gh pr checks --watch` (if no CI exists yet, rely on the local checks), squash-merge, delete the branch, switch back to `main` and pull.

e) Append a dated entry to `docs/JOURNAL.md` (what, why, checks, PR link) in the same PR.

f) Finish with a report: DONE or BLOCKED, what was built, check results, PR link, and what remains.

g) Stop and ask the user ONLY for: interactive logins, sudo/administrator passwords, real secret values, any action that creates paid Azure resources or deletes data/resources (`terraform apply`/`destroy`, `az ... delete`), and production approvals. Everything else you decide and do yourself, documenting important choices as ADRs.
