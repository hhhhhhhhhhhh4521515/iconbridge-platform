# IconBridge Jobs

Recruitment platform where candidates apply for jobs in Malta, Poland and on cruise ships.

## Quick start

Requirements: Node 22 (`nvm use`), pnpm through corepack, Docker running. Work inside WSL, not on a Windows drive.

```bash
pnpm install
pnpm env:init   # creates .env, apps/api/.env and apps/web/.env from the examples
pnpm dev        # compose services + web + api
```

| URL                                  | What                                |
| ------------------------------------ | ----------------------------------- |
| <http://localhost:3000>              | Web app                             |
| <http://localhost:4000/api/docs>     | Swagger UI                          |
| <http://localhost:4000/health/ready> | API readiness (checks the database) |
| <http://localhost:8025>              | Mailpit inbox                       |

Browser tests need Chromium and its system libraries once: `pnpm --filter @iconbridge/web exec playwright install chromium`, then `sudo pnpm --filter @iconbridge/web exec playwright install-deps chromium`.

Other commands: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format`, `pnpm db:migrate`, `pnpm db:seed`.

## Documentation

- [docs/SPEC.md](docs/SPEC.md): functional specification
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): structure of the repository
- [docs/00-environment.md](docs/00-environment.md): workstation and Azure constraints
- [docs/adr/](docs/adr/): architecture decisions
- [docs/JOURNAL.md](docs/JOURNAL.md): work log
- [CLAUDE.md](CLAUDE.md): conventions and workflow for Claude Code
