# ADR-011: Security hardening, email outbox, cache invalidation and the browser test stack

Date: 2026-10-12. Status: accepted.

## Context

Before deployment the repository was audited as a security reviewer and a QA lead would: OWASP Top 10, dependency and secret scans, coverage, load, three browser engines, accessibility. The audit asked for several mechanisms that did not exist. This record keeps the choices that were not obvious. The controls themselves are described in [SECURITY.md](../SECURITY.md), the results in [QA-REPORT.md](../QA-REPORT.md).

## Decisions

### 1. Emails go through an outbox table

Sending inside the request made a bulk change of 100 applications wait for 100 SMTP exchanges, and lost the email when SMTP was down.

- `mail.send()` inserts a row; delivery is a background run in the same process plus the `send-emails` task every minute. No queue service: PostgreSQL is already there, the volume is small, and the API scales to zero, where an in-memory queue would be lost.
- A row is claimed with a lease (`UPDATE … WHERE status = 'PENDING' AND next_attempt_at <= now`) rather than `SELECT … FOR UPDATE SKIP LOCKED`, because sending takes seconds and must not hold a transaction open.
- Content is encrypted in the row and erased once sent: the outbox must not become a second copy of personal data.
- 20 attempts with a doubling wait capped at 6 hours: about three days of outage are survived. After that the email is given up and its content erased; a person reading the task report is the only alarm until alerting exists.
- Rejected: BullMQ or Azure Service Bus (a paid or extra service for a few hundred emails a day).

### 2. Content-Security-Policy with nonces, at the price of static pages

A nonce per response is the only CSP that blocks injected scripts without listing hashes by hand. Next.js can only put the nonce in pages it renders per request, so the public pages are no longer served as static files. Their data still comes from the tagged fetch cache, and the load test shows the cost is small (see the report). Styles keep `'unsafe-inline'`: Tailwind and Next.js write style attributes.

zod probes `new Function` when an object schema is created; the CSP refuses it and browsers report it on every page with a form. `packages/shared/src/zod-setup.ts` tells zod not to try when it runs in a browser; the API keeps the compiled checks.

### 3. The API tells the web app what changed

Pages kept API answers for 60 seconds, so a recruiter who published a job did not see it on the site at once. Controllers that change public content carry `@Revalidates('jobs', …)`; after a successful write the API posts the tags to `/api/revalidate` of the web app, which calls `revalidateTag`. A shared secret protects the route; the call is fire-and-forget, and the 60-second expiry remains as a safety net.

Rejected: no caching at all (every visit would query the API), and webhooks per record (tags are enough at this size).

### 4. Inactive accounts are erased by a scheduled task

24 months without activity, a warning 30 days before, never while an application is in progress. The task reuses `AccountService.eraseCandidate`, the erasure of a GDPR request, so there is one definition of "erased". Contact messages follow the same period. The periods are constants shared with the privacy policy and still need a legal review.

### 5. Dates are three lists, not `<input type="date">`

A native date input follows the language of the browser, not of the page (an Arabic page showed an English calendar), and each engine draws it differently. `DateField` is three `<select>` in the order of the page language, with month names from `Intl`. It needs no JavaScript library and is the same in Chromium, Firefox and WebKit.

### 6. Browser tests: no rate limits, WebKit over HTTPS in a container, clean-up by registry

- Every test signs in from one address; with 5 sign-ins a minute the suite would mostly wait. `RATE_LIMITS_ENABLED=false` exists for the test and load stacks and makes the API refuse to start in production. The limits themselves are tested in the API e2e suite.
- WebKit does not keep `Secure` cookies on `http://localhost`. Rather than weaken the cookies for tests, the WebKit run serves the site over HTTPS, as production does. It runs in the Playwright container because WebKit needs system libraries that require administrator rights on a developer machine.
- Tests share one development database with the person working on it. Each test removes what it creates, and a registry (`e2e/.created.jsonl`) plus name prefixes let the global teardown finish the job after a failure. Tests that change a value shared by the whole site run in one browser only, and put it back.

## Consequences

- One more table and one more task; SMTP outages no longer lose emails for three days.
- Public pages cost a render per request. If traffic grows, a CDN in front of the web app (with the nonce replaced by hashes) is the next step.
- The web app has a second secret to configure (`REVALIDATE_SECRET`), the same value on both sides.
- `pnpm test:browser` needs `pnpm dev` stopped; `pnpm test:browser:webkit` needs Docker.
