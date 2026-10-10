# ADR-001: Stack choice

- Status: accepted
- Date: 2026-10-10

## Context

IconBridge Jobs needs a public site (SEO, three languages including RTL Arabic), a candidate area, an admin back office and a REST API with strict business rules (the 6-month re-application rule). It is built by one developer and hosted on an Azure for Students subscription: 100 USD credit, one Container Apps environment, one free PostgreSQL B1ms server, region `italynorth` (see [00-environment.md](../00-environment.md)).

## Decision

| Area       | Choice                                      | Reason                                                                                        |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Language   | TypeScript (strict) everywhere              | One language for web, API and shared rules                                                    |
| Monorepo   | pnpm workspaces + Turborepo                 | Shared packages without publishing; cached, ordered tasks                                     |
| Web        | Next.js App Router, Tailwind CSS, shadcn/ui | Server rendering for SEO and JSON-LD; shadcn components are owned source code and support RTL |
| API        | NestJS REST + Swagger                       | Modules, guards and dependency injection fit role-based access; OpenAPI is generated          |
| Validation | zod in `packages/shared`                    | The same schema validates the form in the browser and the request in the API                  |
| Database   | PostgreSQL 16 + Prisma                      | Transactions and row locks for the re-application rule; matches the free Azure offer          |
| Files      | Azure Blob Storage, Azurite locally         | Private containers with short-lived SAS links                                                 |
| Email      | SMTP (Nodemailer), Mailpit locally          | Provider-independent; port 587 because port 25 is blocked in Azure                            |
| Hosting    | Azure Container Apps, scale 0 to 2          | Scale to zero protects the credit                                                             |
| IaC / CI   | Terraform + GitHub Actions with OIDC        | No stored client secret                                                                       |

Version choices made when the repository was created (2026-10-10):

| Choice                                          | Reason                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Node 22 LTS                                     | Node 20 is end-of-life                                                                                           |
| NestJS 12 as native ESM, tested with Vitest     | This is what the Nest 12 template generates; `apps/api` has `"type": "module"` and relative imports end in `.js` |
| TypeScript 6.0.x, not 7                         | typescript-eslint and the Nest CLI do not support 7 yet                                                          |
| ESLint 9, not 10                                | The plugins inside `eslint-config-next` do not support 10 yet                                                    |
| Prisma 7.10.0, pinned                           | npm `latest` currently points to an 8.0 release candidate                                                        |
| `packages/shared` compiled to `dist` with `tsc` | Both Node (API) and Next.js load plain ESM; no bundler needed                                                    |

## Consequences

- `packages/shared` must be built before the apps. Turborepo does this (`dependsOn: ["^build"]`), and `pnpm dev` runs it in watch mode.
- Prisma 7 generates its client into `apps/api/src/generated` (git-ignored). The `db:generate` Turborepo task runs before build, lint, typecheck, test and dev.
- Shared versions (TypeScript, zod, Vitest, ESLint) are set once in the `catalog` of `pnpm-workspace.yaml`. Revisit the TypeScript and ESLint pins when the tools above support the newer majors.
- Two frameworks to keep up to date instead of one full-stack Next.js app. Accepted for a clear API boundary and generated OpenAPI.
