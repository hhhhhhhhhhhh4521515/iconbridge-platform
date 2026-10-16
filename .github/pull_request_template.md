## What and why

<!-- What changes for a candidate, a recruiter or the platform, and why. Link the issue if any. -->

## How it was checked

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`
- [ ] `pnpm test:e2e` (API changes)
- [ ] `pnpm test:browser` (web changes), axe check for new pages
- [ ] Verified by hand: <!-- what, where -->

## Checklist

- [ ] Business rules have tests, enforced in the API (CLAUDE.md)
- [ ] Texts in en, fr and ar; logical CSS for Arabic
- [ ] No personal data in logs, no secret in the code
- [ ] Migrations work with the version still running
- [ ] `docs/JOURNAL.md` entry; ADR for an important choice
