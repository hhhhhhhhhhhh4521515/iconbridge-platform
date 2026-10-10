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
