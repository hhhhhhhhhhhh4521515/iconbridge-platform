# ADR-027: Partner spaces

Date: 2026-11-11. Status: **accepted** (owner's answers of 11 November 2026, section 10). Delivered in six pull requests (section 9).

## Context

IconBridge works with partner companies (for example a Polish cleaning company) that need workers for their own demands. For each partner, IconBridge staff and the partner's people want one shared workspace to:

- record the partner's job demands;
- follow the people put forward for each demand through the visa process: documents, visa appointment and decision, documents sent by DHL;
- exchange comments.

This work is private to the partner and IconBridge. It must never mix with the public site: no public job, no candidate account, no application of the normal pipeline, no dashboard figure, no export, no search result, and no email to a candidate. The people in a partner space are not platform users; they never sign in.

The partner's people speak Polish, French or English, not Arabic. The public site and the back office keep English, French and Arabic.

## Decision

### 1. Separate tables, a separate role, a separate area

- Partner spaces live in their own tables (section 3). No foreign key or query links them to `jobs`, `applications`, `candidate_profiles` or `documents`, so public listings, search, the dashboard, exports, job alerts and the retention task cannot see them by construction. Tests prove it anyway (section 8).
- New role **`PARTNER`** for the partner's logins, in the Prisma enum and in `USER_ROLES` of `packages/shared`, both changed together (`enums.spec.ts`). `PARTNER` is in no entry of `PERMISSIONS`. It is not in `ADMIN_ROLES`, so it can never reach a back-office route.
- The web app gets a separate area, **`/partners/{en|fr|pl}/…`**, outside `app/[locale]`, with its own layout, messages and language switch (section 6).

### 2. Who can do what

| Action                                                                                     | Super admin (back office) | Member of the space (staff or partner login) | Anyone else |
| ------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------- | ----------- |
| Create, rename, disable, enable, delete a space; set its country, default language, logo   | Yes                       | -                                            | -           |
| Create partner logins ("Set the password now"), disable or enable them, set a new password | Yes                       | -                                            | -           |
| Choose which IconBridge staff are members                                                  | Yes                       | -                                            | -           |
| See and edit the content of the space: job demands, applications, files, comments, history | Only if also a member     | **Yes, all members alike**                   | 404         |
| Delete one application with its files and comments (for example an erasure request)        | Yes, as a member          | -                                            | 404         |

- **The same rights for every member** inside a space, as asked. A member's back-office role does not matter inside a space.
- **The super admin manages spaces without seeing their content**: create, members, logins, disable, delete. They see the content only after adding themselves as a member; that addition is audited and shown to the space in its history (answer 1).
- **Staff members:** any active back-office account (viewer, country agent, recruiter, super admin) can be added. Inside the space it has full rights, even a viewer (answer 2).
- **Deleting an application** is for a super admin only, who must be a member to find it. It removes the application, its files and its comments (section 7, rule 11; answer 4). Members close job demands; they delete nothing.
- **A partner login belongs to exactly one space**, given when it is created and never moved. It can do nothing else:
  - no back office;
  - no other space;
  - no candidate, application or document of the public site;
  - no setting, no account list.
    It can change its own password and sign out.

### 3. Data model

New tables, following the conventions of ARCHITECTURE.md ("Data model"):

- UUID keys;
- snake_case names;
- `timestamptz` timestamps;
- `created_at` and `updated_at` on every table except the append-only history.

Every child row carries **`partner_space_id`**, and its foreign keys to its parents are **composite** (`(partner_space_id, id)`). The database itself refuses an application of space A attached to a job demand of space B.

| Table                   | Columns (main)                                                                                                                                                                                                                                                                                          | Rules                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `partner_spaces`        | `name` (≤ 120), `country` (ISO 3166-1 alpha-2), `default_locale` (`en`/`fr`/`pl`), `logo_path` (nullable), `is_active`, `created_by`                                                                                                                                                                    | CHECK on `default_locale` and on the country format; `name` unique ignoring case                                                                                                                                                           |
| `partner_space_members` | `partner_space_id`, `user_id`, `kind` (`STAFF`/`PARTNER`), `added_by`, `created_at`                                                                                                                                                                                                                     | Primary key (`partner_space_id`, `user_id`). Partial unique index on `user_id` where `kind = 'PARTNER'`: one space per partner login. `kind = 'PARTNER'` if and only if the user's role is `PARTNER` (checked by the service, with a test) |
| `partner_jobs`          | `role` (≤ 120, e.g. "Housekeeping"), `positions` (> 0), `locations` (text[], 1 to 10 places), `salary` (optional text ≤ 200), `description` (plain text ≤ 5000), `status` (`OPEN`/`CLOSED`), `closed_at`, `created_by`, `updated_by`                                                                    | `positions` CHECK > 0; `closed_at` set if and only if `status = 'CLOSED'`                                                                                                                                                                  |
| `partner_applications`  | `partner_job_id`, `first_name`, `last_name`, `nationality` (ISO alpha-2), `phone` (optional, E.164), `email` (optional, lower case), `visa_status`, `visa_appointment_date`, `visa_decision_date`, `dhl_sent_date`, `dhl_tracking_number` (≤ 40), `documents_received_date`, `created_by`, `updated_by` | `visa_status` in `NOT_STARTED`, `APPOINTMENT_BOOKED`, `SUBMITTED`, `APPROVED`, `REFUSED`; `visa_decision_date` only when `APPROVED` or `REFUSED`; `dhl_tracking_number` only with `dhl_sent_date`; dates are `date`, not timestamps        |
| `partner_files`         | `partner_application_id`, `kind` (`PASSPORT`/`CV`/`WORK_PERMIT`), `format`, `mime_type`, `size_bytes`, `sha256`, `storage_path` (random), `original_name` (sanitised), `uploaded_by`, `created_at`                                                                                                      | Unique (`partner_application_id`, `kind`): one current file per kind. A new upload replaces the old file and deletes its blob                                                                                                              |
| `partner_comments`      | `partner_job_id` or `partner_application_id` (exactly one, CHECK), `author_id` (nullable, `SET NULL`), `author_name` (snapshot), `body` (plain text ≤ 2000), `created_at`                                                                                                                               | Append-only: no editing (answer 3). Deleted only with their application or space                                                                                                                                                           |
| `partner_history`       | `actor_id` (nullable), `actor_name` (snapshot), `entity_type`, `entity_id`, `partner_application_id` (nullable, the application the entry is about), `action`, `field`, `old_value`, `new_value` (text ≤ 500, cut), `created_at`                                                                        | Append-only, one row per changed field. Rows of a deleted application are removed with it (section 7, rule 11)                                                                                                                             |

- **Users:** the CHECK on `users.locale` becomes `en`/`fr`/`ar`, or `pl` for a `PARTNER`. Staff keep their locale for their emails; the partner area remembers their chosen language in a cookie.
- **Deletion:** `ON DELETE CASCADE` from `partner_spaces` down to every child, so deleting a space removes every row (section 7).
- **ARCHITECTURE.md:** the new CHECK constraints are listed in the "Data model" section.
- **Migrations** follow the rule that the previous API version must keep working: new tables only, plus the widened CHECK and the enum value.

### 4. API

Every route needs a session. Bodies and queries are validated with zod schemas of `packages/shared/src/partner.ts`, through `ZodBody`, `ZodQuery` and `ZodParams`. Errors are `AppException` codes with an English message; the web translates each code (section 6).

**Back office (super admin only)**, under `admin/partner-spaces`:

- `@Roles(...PERMISSIONS.MANAGE_PARTNER_SPACES)`, a new permission held by `SUPER_ADMIN` only.
- `@Audit` on every write, with a loader in `AuditSnapshotService` for `partner_space`. The snapshot never holds a password.

| Method and path                                                                  | Effect                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET`, `POST /admin/partner-spaces`                                              | List, create                                                                                      |
| `GET`, `PATCH /admin/partner-spaces/:spaceId`                                    | Detail (counts only, no content); rename, country, default language, `isActive`                   |
| `PUT`, `DELETE /admin/partner-spaces/:spaceId/logo`                              | Logo: checked from its bytes and re-encoded like job covers, stored in the private container      |
| `DELETE /admin/partner-spaces/:spaceId`                                          | Delete. Body `{ confirmName }` must equal the space's name (section 7)                            |
| `GET`, `POST /admin/partner-spaces/:spaceId/members`, `DELETE …/members/:userId` | Staff members                                                                                     |
| `GET`, `POST /admin/partner-spaces/:spaceId/logins`                              | Partner logins: email, display name, language, password set now (`passwordChangeRequired = true`) |
| `PATCH …/logins/:userId`, `POST …/logins/:userId/password`                       | Disable or enable; set a new password (again "must change at first login")                        |

**Partner area (members)**, under `partner-spaces`:

- A `PartnerSpaceGuard` reads the user's membership and the space's `is_active` on each request.
- A non-member, or a disabled space, answers **404**, exactly like an unknown id.
- `GET /partner-spaces` lists only the caller's active spaces.

| Method and path                                                                              | Effect                                                                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /partner-spaces`, `GET /partner-spaces/:spaceId`                                        | My spaces; one space (name, country, default language, link to the logo)                                           |
| `GET`, `POST /partner-spaces/:spaceId/jobs`                                                  | Job demands (filter open/closed); create                                                                           |
| `GET`, `PATCH /partner-spaces/:spaceId/jobs/:jobId`, `POST …/close`, `POST …/reopen`         | Detail with counts per visa status; edit; close; reopen                                                            |
| `GET`, `POST /partner-spaces/:spaceId/applications`                                          | List (filter by job demand, visa status, search on names); create (`jobId` in the body, checked in the same space) |
| `GET`, `PATCH /partner-spaces/:spaceId/applications/:applicationId`                          | Detail; edit, including the visa and DHL fields                                                                    |
| `PUT /partner-spaces/:spaceId/applications/:applicationId/files/:kind`                       | Upload or replace the passport, CV or work permit (multipart)                                                      |
| `GET /partner-spaces/:spaceId/files/:fileId/link?inline=true`                                | A 5-minute read-only link, to preview (`inline`) or download                                                       |
| `GET`, `POST /partner-spaces/:spaceId/{jobs/:jobId \| applications/:applicationId}/comments` | Comments: author name and time shown                                                                               |
| `GET /partner-spaces/:spaceId/history`                                                       | History, newest first, filter by entity; paginated                                                                 |
| `DELETE /partner-spaces/:spaceId/applications/:applicationId`                                | Super admin and member only: body `{ confirmName }` equal to the applicant's first and last name (section 7)       |

- **Scoping in the query, every time.** Each service method takes `spaceId` from the guard and puts it in the `WHERE` of every query: `findFirst({ where: { id, partnerSpaceId } })`, never `findUnique({ id })` followed by a check. The same goes for updates (`updateMany` with both, count checked) and for file links.
- **No route of the public site, the candidate area or the back office reads these tables**, apart from the super admin's management routes, which return counts, never content.
- **`security.e2e-spec.ts`** lists every new route. None is added to `OPEN_ROUTES`.

### 5. Files

- **Container:** a new private container, **`partner-files`**, created with Terraform in the storage module (owner's approval for the apply). It is used only through `StorageService`, with paths `spaces/<spaceId>/<random>`.
- **The same checks as candidate documents:**
  - `inspectDocument` detects the format from the content;
  - passport and work permit: PDF, JPG or PNG; CV: PDF or DOCX;
  - the size limit is the `MAX_UPLOAD_SIZE_MB` setting;
  - images are re-encoded without their metadata;
  - names are sanitised and the file is stored under a random name;
  - the SHA-256 is recorded.
- **Links:** 5 minutes, read only, `inline` for preview (PDF and images) or attachment, given only after the membership check.
- **History:** each upload, replacement, preview and download is written to the space's history, which records who looked at which file and when.
- **Logo:** in the same container; a link is issued for members only.

### 6. Languages and screens

**Languages**

- The partner area speaks **English, French and Polish only**.
- Its messages are in `apps/web/src/messages/partner/{en,fr,pl}.json`. A unit test refuses missing keys, extra keys and empty values in any of the three files, like the existing messages test.
- Every API error code a partner screen can receive is translated under `partner.api`.
- **Which language is shown:**
  1. the language in the address;
  2. otherwise the user's last choice (a cookie);
  3. otherwise the default language of the space (the first space, for staff with several).
- **Emails:** the only email a partner login receives is the password reset (answer 6). It is sent in **the space's default language** and links to `/partners/{lang}/reset-password`. Its template gains `pl`, and a test checks that every template a `PARTNER` can receive has `en`, `fr` and `pl`. Nothing is ever emailed to the people in a partner space.
- **Unchanged:** the public site and the back office keep `en`, `fr`, `ar` and their routing. `pl` is not added to `LOCALES`.

**Back office screens (super admin; English and French, like the rest of the back office)**

- Menu "Partner spaces".
- List: name, country, active, number of members and logins.
- Create or edit: name, country, default language, logo.
- Tab "Members": add or remove staff accounts.
- Tab "Logins":
  - create a login with "Set the password now";
  - disable or enable a login;
  - set a new password.
- "Delete space": a dialog that states what will be deleted (number of job demands, applications, files) and requires typing the space's name.
- A link "Open the space" appears when the super admin is a member.

**Partner area screens (`/partners/{lang}`)**

- **Sign in:** email, password, Turnstile. It leads to "Choose a new password" when one is required; nothing else can be done before.
- **Forgot password** and **reset password**, with Turnstile, the same answer whether the address exists or not.
- **My spaces** (staff with several spaces). A partner login goes straight to its space.
- **Space home:** job demands, open first, with positions, places, and counts per visa status.
- **Job demand:**
  - its form (role, number of positions, places, optional salary, description);
  - its detail with the applications table: name, nationality, visa status, appointment and decision dates, DHL sent and documents received;
  - close and reopen;
  - comments.
- **Application:**
  - its form (names, nationality, optional phone and email, visa fields, DHL fields);
  - for a super admin only, "Delete application": a dialog that lists what will be deleted and requires typing the applicant's name;
  - the three files, each with upload, preview and download;
  - comments;
  - the history of this application.
- **History of the space:** filter by entity.
- **Header:** the space's logo and name, the language switch EN/FR/PL, change password, sign out.
- **Every screen:**
  - readable without JavaScript, with logical CSS;
  - dates entered with `DateField`;
  - an axe check in a new `partner-accessibility.spec.ts`;
  - `noindex`, and nothing linked from the public site.

### 7. Security rules

1. **404 outside one's spaces**, for every route, read and write, files and links included. An id of another space, or an id of the right space with another space in the path, answers 404 like an unknown one. The rule lives in the query (section 4), not only in the guard.
2. **Partner logins are fenced off.**
   - `RolesGuard` refuses `PARTNER` on every `admin/` route (as it refuses `CANDIDATE`) and on every route without `@Roles` outside `partner-spaces`, except their own account routes: password change, sign out, current session.
   - Candidate routes (`@Roles(CANDIDATE)`) already refuse them.
3. **Sign-in with its own endpoint.**
   - `POST /auth/partner-login` needs a Turnstile token and accepts only `PARTNER` accounts.
   - `POST /auth/login` refuses `PARTNER` accounts. The answer is the same as for a wrong password, so neither endpoint reveals which kind of account an address has.
   - The existing protections apply: rate limit `authSensitive` (5 a minute), lockout after 5 failures, the same answer whether the address exists or not.
   - Staff members sign in to the back office as today and reach the partner area from its menu.
   - "Forgot password" works for partner logins (answer 6): the existing endpoint, the same answer for every address, the email in the space's language. The reset link leads to the partner area, and a reset revokes the login's sessions as today.
4. **Sessions like the back office:** a 15-minute access token, a 7-day refresh token with rotation and reuse detection, cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
5. **Access is cut at once.** The guard reads the user, the membership and the space on every request.
   - Disabling a login: `isActive = false` and `tokenVersion + 1`, and its refresh tokens are revoked.
   - Removing a member, or disabling a space, takes effect on the next request.
6. **"Set the password now"** follows ADR-024:
   - the same strength rules;
   - the password is never shown again, logged or audited;
   - nothing but the password change is possible until it is done.
7. **Deleting a space (GDPR).**
   - A super admin confirms by typing the name.
   - A `PartnerSpaceDeletionService` deletes the space's files first (every blob under `spaces/<spaceId>/`, then a check that none remains), then the rows in one transaction (cascade), then the space's partner logins (users with role `PARTNER` and that membership) and their sessions.
   - The audit entry holds the reason and the counts, never names.
   - If deleting the files fails, nothing is deleted and the error is shown.
8. **No personal data in logs:** ids only. `phone`, `email`, `dhlTrackingNumber` and the names are added to `SENSITIVE_KEYS`.
9. **Plain text only:** descriptions and comments are rendered as text, never as HTML.
10. **Exports:** none in this version.
11. **Deleting one application** (answer 4).
    - Only a `SUPER_ADMIN` who is a member of the space, after confirming by typing the applicant's name.
    - A `PartnerApplicationDeletionService` deletes the files' blobs first; if that fails, nothing is deleted.
    - Then, in one transaction:
      - the application row, with its files and comments (cascade);
      - every history row about it (`partner_application_id`), because their old and new values hold personal data;
      - one new history row: action `APPLICATION_DELETED`, the actor and the time, the application's id, and no name or value.
    - The audit entry holds the space id, the application id and the counts deleted, never names.

### 8. Tests (required before merging the implementation)

- **IDOR e2e** (`partner-spaces.e2e-spec.ts`):
  - for every route in section 4, a member of space A, a member of space B, a partner login of B, a candidate, each back-office role and an anonymous caller;
  - expected answers: 200 or 201 for members of the space, 404 for members of other spaces, 401 for anonymous, 403 for back-office routes;
  - the cases include crossing ids (job of B under space A), file uploads and file links.
- **Fences:**
  - a partner login on every `admin/` route and every candidate route: refused;
  - `POST /auth/login` with a partner login, and `/auth/partner-login` with a staff account: the same answer as a wrong password;
  - without Turnstile: refused.
- **Cut-off:**
  - after disabling a login, the next request with its still-valid access token answers 401, and its refresh token no longer works;
  - after disabling a space or removing a member, the next request answers 404.
- **Deleting an application:**
  - refused (404) for members who are not super admins, and for a super admin who is not a member;
  - refused with a wrong `confirmName`;
  - removes the blobs, the files, the comments and its history rows, and leaves exactly one `APPLICATION_DELETED` entry without personal data;
  - an application of another space answers 404.
- **Forgot password:** a partner login receives the reset email in its space's language, Polish included, linking to the partner area.
- **Separation:**
  - a partner job demand and application, with distinctive names, never appear in the public jobs list, the search, the sitemap, the job alerts, the dashboard figures, the back-office applications and candidates lists, or the exports;
  - no email is queued to an applicant's address.
- **Files:**
  - the type and size checks of candidate documents;
  - metadata removed;
  - a link only for members, expiring after 5 minutes;
  - the blob deleted when its file is replaced;
  - every blob deleted when the space is deleted, and no row left.
- **History:**
  - each change of each field writes one entry with its old and new values;
  - entries are visible only to the space's members.
- **Languages:**
  - `en`, `fr` and `pl` messages of the partner area have the same keys and no empty value;
  - every partner error code has a translation;
  - the reset email exists in Polish.
- **Browser** (Playwright, Chromium and Firefox):
  - the super admin creates a space `E2E …`, a login `e2e-partner-…@example.test` and a membership;
  - the partner signs in, changes the password, creates a job demand and an application, uploads, previews and downloads a file, comments and reads the history in Polish;
  - the super admin deletes the space.
  - Everything is cleaned with `remember()`, and the test runs in the `admin` project.
- **Accessibility:** axe on every partner screen.

### 9. Delivery

The implementation is split into pull requests, each with its tests and green CI:

1. Data model, role `PARTNER`, permission, the guards and the management API for super admins.
2. Partner area API, the scoping, the history and the comments, with the IDOR suite.
3. Files: the Terraform container (an infra apply link for the owner), upload, links, deletion.
4. The super admin's back office screens.
5. The partner area in EN, FR and PL, sign-in with Turnstile, the browser and axe tests.
6. Docs: SPEC (roles and the new section), ARCHITECTURE, SECURITY (each new protection and its test), journal. The privacy policy in EN, FR and AR is updated **before the feature opens** (answer 5): IconBridge processes the data of people put forward to partner companies, kept until the application or the space is deleted.

Production checks use only the test account and data named `E2E …`; no real partner data is created.

### 10. Owner's answers (11 November 2026)

1. **Super admin and content:** a super admin manages a space (create, members, disable, delete) without seeing its content, and sees the content only after adding themselves as a member.
2. **Staff roles:** any back-office role can be a member, with full rights inside the space.
3. **Comments:** append-only.
4. **Deleting:** members cannot delete applications. A super admin can delete one application with all its files and comments, with confirmation (for example an erasure request). The history keeps only "application deleted by X at time Y", without personal data.
5. **Privacy policy:** updated in EN, FR and AR before the feature opens. The data is kept until the space or the application is deleted.
6. **Forgot password:** available to partner logins, with the email in the space's language.

The separate partner sign-in endpoint with Turnstile (section 7, rule 3) is approved.

### 11. Implementation notes

- **PR 1** (data model, role, fences, management API):
  - `users.display_name` (≤ 80, optional) holds the name shown to a space's members. A staff account without one is shown by its address.
  - The role value `PARTNER` has its own migration, before the tables: PostgreSQL does not let a new enum value be used in the transaction that adds it, and the `users_locale_check` constraint uses it.
  - Partner logins reach only the routes marked `@PartnerAccess()` (an allowlist in `RolesGuard`), so a new route never opens to them by accident.
  - Until the partner sign-in (PR 5), `/auth/login` refuses them, and forgot-password and resend-verification send them nothing.
  - Deleting a space refuses while it holds files: their deletion arrives with the upload routes (PR 3).
  - The logo routes also arrive with the container (PR 3).

## Consequences

- One more role, and the screens of the partner area to keep translated in three languages, Polish among them.
- No change to the public site, the candidate area, the existing back-office permissions, or `LOCALES`.
- One infra apply (the private container), at no extra cost within the free 5 GB of Blob storage.
- The rule "scope in the query" (section 4) and the IDOR suite are the core of the feature's security. Every later route of the partner area must follow them and be added to the suite.
