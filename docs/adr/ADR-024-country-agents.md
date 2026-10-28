# ADR-024: Country agents, passwords set by the super admin, optional story quotes

Date: 2026-10-28. Status: accepted.

## Context

The agency works with recruitment agents in the candidates' countries (first Morocco and Tunisia). An agent follows the candidates of his country through the pipeline: he reads their files and moves their applications, but must not see anybody else, nor touch jobs, content, exports, settings or accounts. The existing roles do not fit: a viewer cannot write, a recruiter sees everyone and manages jobs.

Agents also need an account the owner can hand over at once, without waiting for an invitation email, and on the agency's domain (`@iconbridgerecruitment.com`), whose mail is forwarded by Cloudflare Email Routing.

Separately, many success stories have no quote from the candidate, and the form refused them.

## Decision

1. **Role `COUNTRY_AGENT`** in `USER_ROLES` and `ADMIN_ROLES` (Prisma enum and `packages/shared`), with `users.assigned_countries` (`text[]`, ISO 3166-1 alpha-2 codes). A CHECK constraint keeps the list non-empty for an agent and empty for every other role, with two-letter upper-case codes only.

2. **A candidate belongs to a country by nationality only** (`candidate_profiles.nationality`), never by country of residence: a Moroccan living in Italy is followed by the Moroccan agent.

3. **Scoping in the API, in one place.** `candidateScope(user)` returns the Prisma condition (`nationality IN assigned_countries` for an agent, nothing for other roles). The candidates, applications, documents and statistics services apply it to every query: list, search, detail, status change, bulk change, undo, notes, document download, dashboard. A record outside the scope answers **404**, exactly like a missing one, so ids cannot be probed. A candidate without a nationality is outside every agent's scope.

4. **Permissions** (table of SPEC section 2, `PERMISSIONS` in `packages/shared`):
   - `VIEW_CANDIDATES` and `MANAGE_APPLICATIONS` include the agent (scoped): read candidates, documents, applications and history; change statuses through `allowedApplicationTransitions` (same moves as a recruiter, no reopening), with `messageToCandidate` and its email; internal notes; undo his own last change.
   - New `MANAGE_CANDIDATES` (recruiter, super admin): disable or enable a candidate account, reveal a passport number, and delete (with `canDeleteRecords` and `ALLOW_RECRUITER_DELETE`).
   - New `VIEW_BACK_OFFICE` (viewer, recruiter, super admin): the back-office lists that are not about candidates (jobs with drafts, contact messages).
   - Everything else stays as it was and never includes the agent: jobs, content, export, settings, historical figures, users, audit log, cooldown waiver. The destinations and categories lists stay readable by every back-office role (filter labels).

5. **Dashboard of an agent**: application, visa and candidate figures are computed for his countries only; the historical figures (not recorded by nationality) are not shown, and `scopeCountries` tells the page which countries the numbers cover. The open-jobs count is the public one.

6. **Password set by the super admin.** Creating a back-office account takes an optional `password`; changing it later is `POST /admin/users/:id/password`. The password passes the same policy as every other (length, zxcvbn with the email as context), is stored as an argon2id hash, is never returned, logged or written to the audit log (`SENSITIVE_KEYS`), and sets `users.password_change_required`. Without a password, the invitation email is sent as before. Setting a password signs the account out everywhere.

7. **Forced change at first login.** While `password_change_required` is set, `RolesGuard` refuses every authenticated route with 403 `PASSWORD_CHANGE_REQUIRED`, except those marked `@AllowPasswordChange()`: the session, `GET /auth/me`, logout and `POST /me/password`. Changing the password, or resetting it through the email link, clears the flag. The back office sends such a user to its new page "My password" (`/admin/password`), which every back-office user can also open later.

8. **Optional story quote.** The three texts of "What the candidate says" may be empty (`optionalLocalizedTextSchema`, same JSON column, no migration). The public cards and the success-stories page show the quote like the other translated texts (the page's language, else English, else French) and no quote block when all three are empty; a story is saved and published without one.

## Consequences

- Every new endpoint that returns candidate data must apply `candidateScope`; the e2e suite `country-agent.e2e-spec.ts` calls every candidate route as a Moroccan agent with a Tunisian record and expects 404, and every forbidden action and expects 403.
- An agent's countries are changed only by a super admin, with the role (`PATCH /admin/users/:id/role`), and the change is audited.
- The super admin knows the first password of the accounts he creates this way; the forced change limits that to the first sign-in. Accounts on `@iconbridgerecruitment.com` receive their reset emails through Cloudflare Email Routing (DEPLOYMENT.md, "Mail for agent addresses").
- Exports stay closed to agents: a list of another country's candidates cannot leave the platform through them.
