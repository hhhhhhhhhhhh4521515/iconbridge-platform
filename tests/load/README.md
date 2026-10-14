# Load tests

Two [k6](https://k6.io) scripts, 50 virtual users each. They talk to the API directly.

| Script         | What 50 users do                                                            | Fails when                                        |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| `jobs-list.js` | Browse the job list with filters, search (with typos), open a job, for 55 s | p95 over 400 ms (list, detail) or 600 ms (search) |
| `apply.js`     | 50 candidates each apply to 4 jobs at the same time (200 applications)      | p95 of `apply` over 1.5 s, or a check fails       |

## Running

```bash
pnpm infra:up && pnpm db:seed
pnpm --filter @iconbridge/api build
# Rate limits off: all the virtual users share this machine's address.
(cd apps/api && RATE_LIMITS_ENABLED=false node dist/main.js)

k6 run tests/load/jobs-list.js
k6 run tests/load/apply.js        # also needs Mailpit (http://localhost:8025)
```

`RATE_LIMITS_ENABLED=false` is refused when `NODE_ENV=production`. Never run these
scripts against the production site: `apply.js` creates accounts and applications
(with `ADMIN_EMAIL` and `ADMIN_PASSWORD` of a super admin it deletes both at the end;
without them the accounts erase themselves and their applications stay as anonymous,
withdrawn rows).

Options: `API_URL`, `MAILPIT_URL`, and for `apply.js` `VUS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Results of the last run are in
`docs/QA-REPORT.md`.
