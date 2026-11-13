# IconBridge Jobs - Functional specification

Recruitment platform where candidates apply for jobs in **Malta, Poland and on cruise ships**, inspired by <https://iconbridgerecruitmentltd.com>. Admins manage job offers and the recruitment pipeline. Deployed on Azure with Terraform and CI/CD.

This file is the source of truth for features. Read it before starting any feature. Environment facts (region, quotas, budget, CI/CD identity) are in [00-environment.md](00-environment.md); technical structure is in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Tech stack (decided)

| Layer               | Choice                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Monorepo            | pnpm workspaces + Turborepo                                                                               |
| Frontend            | Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui                                              |
| Animations / slider | Framer Motion + Swiper                                                                                    |
| i18n                | next-intl (fr, en, ar with RTL)                                                                           |
| Backend             | NestJS (TypeScript) REST API + OpenAPI/Swagger                                                            |
| Validation          | zod schemas in `packages/shared`, reused by web and api                                                   |
| ORM / DB            | Prisma + PostgreSQL 16                                                                                    |
| Files               | Azure Blob Storage (private containers, short-lived SAS links)                                            |
| Auth                | JWT access token + refresh token in httpOnly cookies, argon2id                                            |
| Email               | Nodemailer over SMTP port 587 (Mailpit locally, Brevo or Azure Communication Services in prod)            |
| Local dev           | Docker Compose: Postgres, Azurite, Mailpit                                                                |
| Runtime             | Node.js 22 LTS                                                                                            |
| Hosting             | Azure Container Apps (web + api), Azure Container Registry Standard (free 12 months), ghcr.io as fallback |
| Database (cloud)    | Azure Database for PostgreSQL Flexible Server, B1ms, 32 GB (free 750 h/month offer, one server only)      |
| Secrets             | Azure Key Vault + user-assigned Managed Identity                                                          |
| Observability       | Log Analytics (daily cap) + Application Insights                                                          |
| IaC                 | Terraform (azurerm), remote state in Azure Storage                                                        |
| CI/CD               | GitHub Actions + OIDC login to Azure (fallback documented in 00-environment.md)                           |

The reasons are recorded in [ADR-001](adr/ADR-001-stack-choice.md).

## 2. Roles and privileges

| Role              | Code in `packages/shared` | Who                                                                        |
| ----------------- | ------------------------- | -------------------------------------------------------------------------- |
| Visitor           | none (not signed in)      | Anyone                                                                     |
| Candidate         | `CANDIDATE`               | Registered job seeker                                                      |
| Viewer (agent)    | `VIEWER`                  | Read-only back-office user                                                 |
| Country agent     | `COUNTRY_AGENT`           | Recruitment agent for one or more countries (ISO codes stored on the user) |
| Recruiter (admin) | `RECRUITER`               | Back-office user                                                           |
| Super admin       | `SUPER_ADMIN`             | Platform owner                                                             |
| Partner           | `PARTNER`                 | Login of a partner company: its partner space only (ADR-027)               |

A candidate belongs to a country by **nationality** only, never by country of residence. "Own countries" below means: only candidates whose nationality is one of the agent's countries; any other candidate, application or document answers 404, as if it did not exist ([ADR-024](adr/ADR-024-country-agents.md)).

| Capability                                                                            | Visitor | Candidate | Viewer    | Country agent                  | Recruiter                                                           | Super admin |
| ------------------------------------------------------------------------------------- | ------- | --------- | --------- | ------------------------------ | ------------------------------------------------------------------- | ----------- |
| Browse jobs, home, success stories                                                    | Yes     | Yes       | Yes       | Yes                            | Yes                                                                 | Yes         |
| Register, verify email, manage own profile and documents                              | -       | Yes       | -         | -                              | -                                                                   | -           |
| Apply to a job, withdraw, track status                                                | -       | Yes       | -         | -                              | -                                                                   | -           |
| Download / delete own data (GDPR)                                                     | -       | Yes       | -         | -                              | -                                                                   | -           |
| See candidates, applications, status history, documents (5-minute links, audited)     | -       | -         | Read only | Own countries, read only       | Yes                                                                 | Yes         |
| See the back-office lists of jobs (drafts included) and contact messages              | -       | -         | Yes       | -                              | Yes                                                                 | Yes         |
| Create / edit / publish / close / delete job offers                                   | -       | -         | -         | -                              | Yes                                                                 | Yes         |
| Change application status (with a message to the candidate), add internal notes       | -       | -         | -         | Own countries                  | Yes                                                                 | Yes         |
| Disable / enable a candidate account, reveal a full passport number (audited)         | -       | -         | -         | -                              | Yes                                                                 | Yes         |
| Manage success stories, home slides, categories, destinations                         | -       | -         | -         | -                              | Yes                                                                 | Yes         |
| Export applications to CSV / Excel                                                    | -       | -         | -         | -                              | Yes                                                                 | Yes         |
| Create / disable admin accounts, assign roles and countries, set a first password     | -       | -         | -         | -                              | -                                                                   | Yes         |
| Global settings (cooldown period, upload limits), audit log                           | -       | -         | -         | -                              | -                                                                   | Yes         |
| Enter historical results (figures from before the platform)                           | -       | -         | -         | -                              | -                                                                   | Yes         |
| See the dashboard                                                                     | -       | -         | Yes       | Own countries only, no history | Yes                                                                 | Yes         |
| See the split "historical + platform" on the dashboard                                | -       | -         | Yes       | -                              | Yes                                                                 | Yes         |
| Delete a candidate or an application (with a reason, audited)                         | -       | -         | -         | -                              | Only if the setting `ALLOW_RECRUITER_DELETE` is on (off by default) | Yes         |
| Delete a contact message, delete an admin account, erase the job alerts of an address | -       | -         | -         | -                              | -                                                                   | Yes         |
| Lift the waiting period of one finished application (with a reason, audited)          | -       | -         | -         | -                              | -                                                                   | Yes         |
| Manage partner spaces, their staff members and partner logins (not their content)     | -       | -         | -         | -                              | -                                                                   | Yes         |

A `PARTNER` login holds none of these capabilities. It reaches its own partner space and its password, nothing else. Inside a space, every member (staff or partner) has the same rights ([ADR-027](adr/ADR-027-partner-spaces.md)).

- The first super admin is created by a seed script from environment variables.
- There is no public sign-up for admins. A super admin creates a back-office account either with an invitation email (the person chooses the password) or by setting the first password directly; in that case the person must choose a new password at the first sign-in and can do nothing else before. The password follows the same strength rules, is never shown again, logged or audited.
- A country agent has at least one country; other roles have none. Only a super admin changes them, and the change is audited.

## 3. Candidate profile

| Group              | Fields                                                                                                                                                           | Rules                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Identity           | First name, last name, gender, date of birth, nationality, country of residence, city, phone (with country code), WhatsApp                                       | Must be 18 or older                                                                     |
| Passport           | Number, issuing country, issue date, expiry date                                                                                                                 | Warn if it expires in less than 6 months; block applying if expired                     |
| Profile            | Current profession, years of experience, education level, languages with level (English, French, Arabic, Italian, Polish, German...), driving licence categories |                                                                                         |
| Documents          | CV, passport scan, ID photo, diplomas and certificates                                                                                                           | CV: PDF/DOCX, max 5 MB, required. Passport scan: PDF/JPG/PNG, required. Others optional |
| Cruise-ship extras | STCW basic safety training, seaman's book, medical certificate (PEME/ENG1), previous sea experience                                                              | Shown only for cruise jobs                                                              |
| Consent            | GDPR / data-processing checkbox                                                                                                                                  | Date of consent stored                                                                  |

The site, the candidate area and the emails carry no message about money, fees or applying for free (removed on 2 November 2026 at the owner's request).

## 4. Job offers

### 4.1 Fields

Title, slug, destination, category, employer name (optional, can be hidden), description, requirements, benefits (accommodation, transport, meals), salary min/max + currency + period, contract duration, working hours, number of positions, required languages, application deadline, cover image, status, "featured" flag.

- **Destination**: Malta, Poland, Cruise ship. Stored as a table so new countries can be added. Built-in codes: `MALTA`, `POLAND`, `CRUISE_SHIP`.
- **Status**: Draft, Published, Closed, Archived (`DRAFT`, `PUBLISHED`, `CLOSED`, `ARCHIVED`).

### 4.2 Availability rules

1. **Listed**: a job appears on the public site and in the back office from its publication until it is archived or deleted: status Published or Closed. Drafts and archived jobs are not on the public site.
2. **Open**: a listed job accepts applications only when it is Published, its deadline has not passed and positions remain. A listed job that is not open stays on the jobs page (after the open ones) with a "Closed" badge; its page still opens, and the Apply button is replaced by "This job is closed". The API refuses new applications to it (`JOB_NOT_OPEN`).
3. **Filled positions**: a position is filled by an application that reaches **Contract signed**, not by applying. `hiredCount` is the number of applications of the job at Contract signed or a later step (Visa processing, Visa approved, Deployed); it goes down when such an application leaves these steps (rejected, status change undone) or is deleted. Moving an application to Contract signed is refused when every position is filled (`NO_POSITION_LEFT`).
4. **Closing and reopening**: a job closes automatically when its deadline passes or when `hiredCount` reaches the number of positions. A job closed because its positions were filled reopens automatically when `hiredCount` drops below the number of positions and the deadline has not passed. A job closed by a recruiter stays closed until a recruiter reopens it.
5. Delete is a soft delete: the job is kept for history and existing applications.

## 5. Application pipeline

Statuses, in order:

| #   | Status          | Code              |
| --- | --------------- | ----------------- |
| 1   | Submitted       | `SUBMITTED`       |
| 2   | Under review    | `UNDER_REVIEW`    |
| 3   | Shortlisted     | `SHORTLISTED`     |
| 4   | Interview       | `INTERVIEW`       |
| 5   | Offer           | `OFFER`           |
| 6   | Contract signed | `CONTRACT_SIGNED` |
| 7   | Visa processing | `VISA_PROCESSING` |
| 8   | Visa approved   | `VISA_APPROVED`   |
| 9   | Deployed        | `DEPLOYED`        |

Exit statuses: Rejected (`REJECTED`) and Withdrawn (`WITHDRAWN`, by the candidate).

- Each change is stored in a history table: who, when, from, to, comment.
- Each change emails the candidate.
- Internal notes are never visible to candidates.

## 6. Business rule: one application per job every 6 months

1. A candidate cannot apply to the same job again until **6 calendar months** after the date of their last application to that job, whatever its status (including Rejected and Withdrawn).
2. The period is a setting, `REAPPLY_COOLDOWN_MONTHS=6`, editable by the super admin.
3. The rule is enforced in the API inside a database transaction, with a lock so two fast clicks cannot create two applications. The UI check alone is not enough.
4. The job page shows "You applied on 12/03/2026 - you can apply again from 12/09/2026" instead of the Apply button.
5. The API returns HTTP 409 with code `REAPPLY_COOLDOWN` and the next allowed date.
6. Optional setting: maximum number of active applications per candidate (default 5).
7. A super admin may lift the waiting period of one finished application (Deployed, Rejected or Withdrawn), with a reason kept in the audit log, for example when a candidate was rejected by mistake. That application then no longer counts for the rule; the next application starts a new period. Nothing is sent to the candidate.

## 7. Other features

### 7.1 Home page

Animated hero slider (Malta, Poland, cruise ship slides managed by admin), job search bar, animated counters, destinations, categories, latest jobs, "How it works" in 3 steps, success-stories carousel, testimonials, FAQ, contact form, job-alert subscription.

**Counters.** The home page shows open jobs, registered candidates, visas approved, partner companies and countries. IconBridge placed candidates before this platform existed, so the counters add **historical results** entered by the super admin to the live data:

| Counter               | Live data of the platform                      | Historical figure added                                                             |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Visas approved        | Applications in Visa approved or Deployed      | Visas approved, per year and destination                                            |
| Registered candidates | Active candidate accounts                      | Candidates registered/processed, per year and destination                           |
| Partner companies     | Distinct employers of jobs that were published | Partner companies (one global figure)                                               |
| Countries             | Active destinations                            | Countries served (one global figure); the larger of the two is shown, not their sum |
| Open jobs             | Jobs open now                                  | None                                                                                |

Historical figures are stored apart from applications (year, destination, metric, value, note), every change is written to the audit log, and the back-office dashboard shows each total with its split (for example 253 = 250 historical + 3 platform) and can switch to "Platform only". Candidates deployed is a dashboard figure only.

A success story has a photo, name, job, destination, visa date and an optional short quote ("What the candidate says", in English, French and Arabic; the site shows no quote block when it is empty). It is published only with the candidate's written consent.

### 7.2 Jobs page

Filters by destination, category, salary and language; full-text search; pagination; shareable job URLs with SEO meta and JSON-LD `JobPosting`.

### 7.3 Notifications

Email on registration, verification, application received, every status change, and new jobs matching job alerts.

### 7.4 Admin dashboard

KPIs (open jobs, applications this month, visas approved, by destination), a Kanban/table view of applications, candidate search, document preview, CSV export, audit log. A country agent sees the figures of his countries only.

The applications and candidates lists filter by **nationality** (never country of residence): all nationalities, Morocco, Tunisia, "Other (not Morocco/Tunisia)" (any other nationality, or none given), then every country A–Z. Both lists show a Nationality column with the flag. The filters (status, destination, nationality, search) combine, stay in the address of the page, and decide the totals and the CSV export. A country agent can only choose his own countries; the API returns nothing for any other.

### 7.5 Security and legal

Rate limiting, CAPTCHA (Cloudflare Turnstile) on register/apply/contact and on the partner sign-in, private files, GDPR data export and account deletion, privacy policy and terms pages.

Data retention: a candidate account with no activity for 24 months and no application in progress is erased like a GDPR deletion, after a warning email 30 days before; messages of the contact form are deleted after 24 months. Uploaded pictures lose their metadata (EXIF, GPS). The full list of protections is in [SECURITY.md](SECURITY.md).

### 7.6 Partner spaces

A private workspace per partner company ([ADR-027](adr/ADR-027-partner-spaces.md)), at `/partners/{en|fr|pl}`, in English, French or Polish, not linked from the public site and not indexed.

- **Super admin, in the back office ("Partner spaces"):**
  - creates a space (name, country, default language, logo);
  - adds back-office accounts as members;
  - creates the partner company's logins with a first password;
  - disables, enables or deletes a space;
  - sees settings and counts only, and the content only after adding themselves as a member.
- **Members** (the partner logins and the staff added), all with the same rights:
  - job demands: role, positions, places, optional salary and description; close and reopen;
  - applications: names, nationality, optional phone and email, visa status and dates, DHL dates and tracking number;
  - the passport, CV and work permit, with preview and download;
  - append-only comments;
  - a history of every change, file opened and comment.
- **Deleting an application** (for example after an erasure request): a super admin who is a member, after typing the person's name. Its files, comments and history go; one line without personal data remains.
- **Partner logins:**
  - sign in on their own page with Turnstile, and choose their own password at the first sign-in;
  - can reset it by email in the space's language;
  - nothing else is ever emailed, and nothing is sent to the people in a space.
- **Separation:** none of these data appear on the public site, in candidate accounts, in the back-office lists, counters or exports, or in job alerts. The data are kept until the application or the space is deleted (privacy policy, "People put forward to our partner companies").

## 8. Azure for Students constraints

- 100 USD credit for 12 months; when it runs out the subscription is disabled.
- PostgreSQL is free only for one B1ms server with 32 GB storage (750 h/month). Never bigger, never a second server.
- Allowed regions, vCPU quota, budget support and the CI/CD identity option are recorded in [00-environment.md](00-environment.md). Always follow them.
- Free for 12 months on this subscription (confirmed in the portal): PostgreSQL B1ms 750 h + 32 GB, one Container Registry Standard, Key Vault 10,000 transactions, Blob 5 GB hot LRS, 15 GB outbound bandwidth. Stay inside these sizes.
- Keep min replicas at 0 and max at 2; set a Log Analytics daily cap; only ONE Container Apps environment (quota); region `italynorth`.
- Outbound SMTP port 25 is blocked: use port 587.
