# QA report

Security and quality audit of IconBridge Jobs, 11 to 14 October 2026, on the branch `feat/security-qa-audit`. Everything below was run on the developer workstation (WSL2, PostgreSQL 16, Azurite and Mailpit in Docker); nothing is deployed yet.

**Result: no high or critical finding is open, and every test suite passes.** One high-severity advisory without a fix remains in a lint tool that is not shipped (see [Dependencies](#security-scans)). The risks that remain are listed at the end and in [SECURITY.md](SECURITY.md#remaining-risks).

## Test suites

| Suite                                    | Command                    | Result                                              |
| ---------------------------------------- | -------------------------- | --------------------------------------------------- |
| Lint (with eslint-plugin-security)       | `pnpm lint`                | Pass                                                |
| Types                                    | `pnpm typecheck`           | Pass                                                |
| Unit tests                               | `pnpm test`                | Pass: 556 tests (shared 205, API 301, web 50)       |
| API end-to-end, real PostgreSQL          | `pnpm test:e2e`            | Pass: 495 tests in 24 files                         |
| Build                                    | `pnpm build`               | Pass                                                |
| Browser: Chromium (desk, phone), Firefox | `pnpm test:browser`        | Pass: 141 passed, 6 skipped (147 runs, 4.8 minutes) |
| Browser: WebKit                          | `pnpm test:browser:webkit` | Pass: 48 passed, 6 skipped                          |

The 6 skipped runs in Firefox and in WebKit are tests that change something shared by the whole site (a setting, a historical figure, the scheduled task) or emulate a phone; they run in Chromium only, so that two browsers do not undo each other's changes.

## Coverage

`pnpm test:cov`; the thresholds are in the Vitest configurations, so a drop fails the command.

| Scope                                                                               | Lines                  | Target      |
| ----------------------------------------------------------------------------------- | ---------------------- | ----------- |
| API, unit and end-to-end together                                                   | 96.6 % (2 214 / 2 292) | —           |
| API services (36 files)                                                             | 95.5 %                 | ≥ 80 %      |
| Lowest services: Azure storage 84.0 %, mail 84.4 %, catalog 86.0 %                  | all above the target   | ≥ 80 % each |
| Re-application cooldown (`cooldown.ts`)                                             | 100 %                  | 100 %       |
| Eligibility and applying (`applications.service.ts`)                                | 100 %                  | 100 %       |
| Status changes (`admin-applications.service.ts`)                                    | 100 %                  | 100 %       |
| Transitions and rules of `packages/shared` (`admin.ts`, `candidate.ts`, `enums.ts`) | 100 %                  | 100 %       |
| `packages/shared` as a whole                                                        | 99.7 % (334 / 335)     | —           |
| Web libraries (`apps/web/src/lib`)                                                  | 96.2 %                 | ≥ 80 %      |

The one line of `packages/shared` not covered is the branch of `zod-setup.ts` that only runs in a browser. React components are not measured by unit coverage; they are exercised by the browser tests.

The 6-month rule is tested at its exact boundary (the last refused second and the first allowed one), with a frozen clock and with parallel requests. The transition matrix is tested in full: every status, every target, every role.

## Security review

The checklist, control by control, is in [SECURITY.md](SECURITY.md). What the audit changed:

| Finding                                                                                                  | Severity   | Fix                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| Rich text of jobs was filtered by a hand-written allow-list                                              | Medium     | Cleaned with DOMPurify on the server, on writing and on reading; 16 tests with XSS payloads               |
| No protection against cross-site requests beyond `SameSite=Lax`                                          | Medium     | Origin check on every state-changing request                                                              |
| Passport scans and photos kept their EXIF data, GPS position included                                    | Medium     | Images are decoded and re-encoded; metadata removed; an undecodable image is refused                      |
| No Content-Security-Policy on the web app; no HSTS or frame protection on its pages                      | Medium     | CSP with a nonce per page, HSTS, `X-Frame-Options`, `nosniff`, referrer and permissions policies          |
| No test proving that every route has a guard                                                             | Medium     | `security.e2e-spec.ts` lists the routes of the running application and checks each                        |
| 4 dependency advisories (uuid, mysql2, deepmerge-ts, and one through the unused `shadcn` package)        | Up to high | Raised with overrides; `shadcn` removed                                                                   |
| A super admin could reopen the application of a candidate who had deleted their account                  | Low        | Refused by the API, with a test; the drawer no longer offers it                                           |
| Messages of the contact form and job alerts of visitors could never be removed                           | Low        | A super admin can delete a message and erase the alerts of an address; old messages leave after 24 months |
| Back-office accounts could be disabled but not deleted                                                   | Low        | `DELETE /admin/users/:id` and a button in the users screen                                                |
| Personal data kept for ever                                                                              | Medium     | `retention` task: warning, then erasure after 24 months without activity                                  |
| zod tried `new Function` on every page with a form (refused by the CSP, reported by browsers)            | Low        | zod is told not to try in a browser                                                                       |
| The confirmation of a role change said the person would be logged out; in fact the rights change at once | Low        | Text corrected in English and French; the behaviour is tested                                             |

### Security scans

| Tool                     | Result                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm audit --prod`      | No known vulnerability                                                                                                                       |
| `pnpm audit`             | 1 high: `braces` through `eslint-config-next`. No fixed version exists; lint tool only, not installed in production. Accepted and documented |
| `trivy fs`               | 0 high or critical (vulnerabilities, secrets, misconfigurations)                                                                             |
| `gitleaks git`           | No leak in the history (three fixture passwords allow-listed by path)                                                                        |
| `gitleaks dir`           | 9 hits, all in git-ignored files: the local `.env` and the Next.js build output                                                              |
| `eslint-plugin-security` | No finding; `detect-object-injection` is off (it flags every `object[key]`), the other rules are on                                          |

## Bugs found while testing

Found by the new browser tests, the load tests and the cross-browser runs, and fixed:

| Bug                                                                                                                               | Effect                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The links of the job alert emails ("confirm", "unsubscribe") led to pages that did not exist                                      | A visitor could never activate or stop a job alert          |
| A request sometimes failed with "socket hang up" between the web app and the API (idle connection closed while it was reused)     | Occasional failed page or action; keep-alive now 65 seconds |
| Back-office tables made the whole page wider than a phone (hidden labels escaping the scroll box)                                 | Applications, jobs and candidates unusable on a phone       |
| The slide preview and the settings said changes take "a minute"; they did                                                         | Now immediate, see performance                              |
| Green status badges: white on emerald-600, contrast 3.7 for 4.5 required                                                          | Hard to read; now emerald-700                               |
| Kanban cards were a "button" containing a button; dashboard charts hidden from screen readers could still take the keyboard focus | Screen reader and keyboard users blocked                    |
| Native date inputs followed the language of the browser, not of the page, and looked different in each browser                    | An Arabic or French page showed an English date picker      |

Introduced and fixed inside this branch, before any release: pooled SMTP connections kept the task command line from exiting once it had sent an email (it would have hung the scheduled job in Azure). The mail service now finishes its emails and closes its connections on shutdown.

## Performance

### Emails

Emails are no longer sent inside requests. `mail.send()` writes to the `email_outbox` table; delivery follows in the background and by the `send-emails` task, with retries for about three days. Tests: `email-outbox.e2e-spec.ts` (9 tests: SMTP down, retries with growing waits, two runners, cancellation, purge). In the load test below, 200 applications produced 450 emails; all were delivered within 100 seconds of the start of the run, none failed, and no request waited for one.

### Queries

`query-count.e2e-spec.ts` counts the SQL queries of 11 list endpoints with 3 rows and with 24: the count is the same, so no list makes a query per row. Three indexes were added (`applications (applied_at DESC)`, `users (role, deleted_at)`, `email_outbox (status, next_attempt_at)`). One loop remains by design: the `job-alerts` task runs one query per subscriber, in the background.

### Caching

- Public `GET` answers of the API carry `Cache-Control: public, max-age=60, stale-while-revalidate=120`.
- The web app caches API answers under tags and the API invalidates the tags when a back-office user changes a job, a story, a slide, the catalog, a setting or a historical figure. Verified in the browser tests: a published story, a new slide, a new destination, a changed phone number and a historical figure are on the public site at the next page view (the tests allow 15 seconds; before, they needed up to 150).

### Load test (k6, 50 virtual users)

Scripts in `tests/load`. API, database and k6 on the same workstation, rate limits off, production build.

| Scenario                                                                        | Requests                     | Failures | p95                                              |
| ------------------------------------------------------------------------------- | ---------------------------- | -------- | ------------------------------------------------ |
| Job list: 50 users browse, filter, search and open jobs for 55 s                | about 7 000 (120 per second) | 0        | list 11–18 ms, search 10–18 ms, job page 7–12 ms |
| Apply: 50 candidates each apply to 4 jobs at the same moment (200 applications) | 862                          | 0        | apply 430–650 ms, eligibility check 460–710 ms   |

Ranges are over three runs. The first run after a restart of the API was slower (apply 1.2 s, eligibility 2.9 s at p95, above the 800 ms threshold of the script for eligibility): 50 simultaneous first requests share a database pool of 10 connections that is still empty. Later runs stay under the thresholds.

Limits of these numbers: the development database holds a dozen jobs and a few hundred rows, and everything runs on one machine. They show that nothing is slow by design; they do not size the Azure deployment. To repeat on the first Azure environment, with realistic data volumes.

## Browsers and accessibility

| Browser                  | Result                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium, desk and phone | All tests pass                                                                                                                                                                                           |
| Firefox                  | All tests pass. One difference found: Firefox reports zod's `new Function` attempt as a CSP violation (fixed)                                                                                            |
| WebKit                   | All tests pass over HTTPS. WebKit does not keep `Secure` cookies on `http://localhost`: nobody stays signed in over plain HTTP. Production is HTTPS; for local work with Safari, use Chromium or Firefox |

WebKit could not be installed on the workstation (its system libraries need administrator rights), so it runs in the official Playwright container, which also serves the site over HTTPS as production will.

New browser tests: forgotten and reset password, invitation and choice of a password, change of password, job alerts (account and visitor, with the emails), language of the page and of the date fields, export of personal data, silent refresh (also verified once against an API with a 5-second access token), home slides, destinations and categories, users (invite, role, log out everywhere, disable, enable, delete), settings, audit log, contact inbox, bulk status change, export dialog, bulk and drawer deletions, the "recruiters may delete" switch, the global historical figures, and the applications screens on a phone.

**axe** (WCAG 2.1 A and AA) runs on 13 public pages in three languages, a job page, the dark theme, 8 pages of the candidate area and 14 screens of the back office, in the three browsers: no violation. The same tests fail on anything the Content-Security-Policy refuses: nothing is refused.

Not covered by axe: screens behind a dialog (drawer, editors) are checked only as far as their trigger page; colour contrast of pictures; real screen-reader sessions.

### Test data

Every test now removes what it creates and restores what it changes, and a global teardown does it again after a failed or interrupted run. After the final runs the development database had no test account, job, slide, message or alert left, and its settings were unchanged.

Cleaned during the audit, through the back-office API (each deletion is in the audit log): 15 invited `e2e-recruiter-*` / `e2e-viewer-*` accounts, 11 test candidates, 6 "E2E Welder" jobs still published on the local site, and the records of the load tests.

**`MAX_UPLOAD_SIZE_MB` was 25 instead of 5.** No test changed it: the API end-to-end tests use their own database, and no browser test touched the settings before this audit. The audit log of the development database shows one `setting.update` by the seeded super admin on 11 October 2026 at 18:01 UTC from the local machine, from 5 to 25 — a manual change in the settings screen. It was set back to 5, the default of the specification. The new settings test checks that value.

## Remaining risks

None is high or critical. Details and mitigations in [SECURITY.md](SECURITY.md#remaining-risks).

| Risk                                                                     | Next step                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Uploaded files are not scanned for malware                               | Decide on Microsoft Defender for Storage (paid) with the deployment |
| No CI: the checks run only when a developer runs them                    | GitHub Actions with the commands of this report                     |
| No alerting on errors, failed sign-ins, failed tasks or abandoned emails | Azure Monitor alerts with the deployment                            |
| Load figures come from one workstation with little data                  | Repeat on Azure with realistic volumes                              |
| `braces` advisory in the lint tooling, no fix available                  | Re-check at each dependency update                                  |
| Retention periods and privacy texts not yet reviewed by a lawyer         | Legal review before opening the site                                |
| CSP allows inline styles                                                 | Accept, or move to hashed styles when Next.js allows                |
| Prisma 7.10 triggers a deprecation warning of the `pg` driver            | Update Prisma before `pg` 9                                         |
| Accessibility checked by tool only                                       | A session with a screen reader in each language before opening      |
