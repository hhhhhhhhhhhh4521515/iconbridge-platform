# ADR-003: Authentication, sessions and access control

- Status: accepted
- Date: 2026-10-10

## Context

Candidates and back-office users sign in to the same API. The platform holds passports and identity documents, so a stolen session or a mistake in a role check has serious consequences. The web app is a separate Next.js application calling the API from the browser.

## Decision

| Topic               | Choice                                                                                                      | Reason                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Transport of tokens | httpOnly, Secure, SameSite=Lax cookies                                                                      | Scripts cannot read them (XSS cannot steal a session); Lax blocks cross-site POST (CSRF)                          |
| Access token        | JWT, HS256, 15 minutes                                                                                      | Short life limits a leak; one service signs and verifies, so a shared secret is enough                            |
| Refresh token       | Opaque random value, 7 days, stored as SHA-256, rotated on every use, families revoked on reuse             | A copied token is detected the first time both copies are used                                                    |
| Revocation          | The user row is loaded on every request and compared with `token_version` in the JWT                        | Disable, role change, password reset and forced logout apply immediately. Cost: one primary-key query per request |
| Library             | `@nestjs/jwt` and hand-written guards, no Passport                                                          | Four small guards are easier to read and test than strategy indirection                                           |
| Roles               | One permission table in `packages/shared`, used by `@Roles()`                                               | A single place mirrors the specification; the web app reads the same table                                        |
| Safety nets         | Candidates refused under `/admin`; `/admin` routes without `@Roles()` closed; VIEWER refused on every write | A forgotten decorator fails closed                                                                                |
| Ownership           | A guard that answers 404 for somebody else's record                                                         | Ids cannot be probed                                                                                              |
| Enumeration         | Identical answers on register, login, forgot password and resend verification                               | An attacker cannot learn which emails have accounts                                                               |
| Lockout             | 5 failures, 15 minutes, per account                                                                         | Asked by the specification; rate limits per IP complement it                                                      |
| Invitations         | Admin accounts are created without a password; the invitation link uses the reset-password endpoint         | No password travels by email and there is one code path to set a password                                         |
| Validation          | zod schemas from `packages/shared` through a pipe; the OpenAPI schema is generated from them                | Web and API validate identically; the documentation cannot drift                                                  |
| Email templates     | MJML with one layout, texts in en / fr / ar                                                                 | Works in mail clients including right-to-left; no React toolchain in the API                                      |
| Audit               | Global interceptor, snapshots loaded before and after the handler                                           | Every admin write is recorded even if the developer adds nothing                                                  |
| e2e tests           | Real PostgreSQL test database, separate `pnpm test:e2e`                                                     | Constraints, transactions and locks are part of the behaviour; unit tests stay runnable without Docker            |

## Consequences

- **Production needs the web app and the API on the same site** (for example `app.example.com` and `api.example.com`, or the web app proxying `/api`). On two unrelated hostnames such as the default `*.azurecontainerapps.io` names, browsers treat the calls as cross-site and do not send SameSite=Lax cookies on POST. This must be settled in the infrastructure step.
- Rate limits are kept in memory, per API replica. With two replicas a client can get up to twice the limit. Move the storage to the database or Redis if that matters.
- Two tabs refreshing at the same instant with the same refresh token are seen as a reuse and the user is signed out. The web app should refresh from one place.
- A locked-out user sees the same message as for a wrong password. This is the price of not revealing which accounts exist; the message mentions the lock.
- Lockout lets someone who knows an email keep that account locked. Rate limits slow this down; a password reset unlocks the account.
- The audit entry is written after the change is committed. If that write fails, the change stays and an error is logged.
- `JWT_ACCESS_SECRET` rotation signs everybody out (they recover through the refresh token). There is one key, no key id.
- Turnstile is only checked on registration for now. Apply and contact forms get it with their features. Outside production, Cloudflare's always-pass test secret is honoured without a network call; production refuses to start with a test secret.
- Email links point to web pages that do not exist yet (`/<locale>/verify-email`, `/reset-password`, `/set-password`, `/forgot-password`).
