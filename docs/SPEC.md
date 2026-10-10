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

| Role              | Code in `packages/shared` | Who                        |
| ----------------- | ------------------------- | -------------------------- |
| Visitor           | none (not signed in)      | Anyone                     |
| Candidate         | `CANDIDATE`               | Registered job seeker      |
| Viewer (agent)    | `VIEWER`                  | Read-only back-office user |
| Recruiter (admin) | `RECRUITER`               | Back-office user           |
| Super admin       | `SUPER_ADMIN`             | Platform owner             |

| Capability                                                    | Visitor | Candidate | Viewer    | Recruiter | Super admin |
| ------------------------------------------------------------- | ------- | --------- | --------- | --------- | ----------- |
| Browse jobs, home, success stories                            | Yes     | Yes       | Yes       | Yes       | Yes         |
| Register, verify email, manage own profile and documents      | -       | Yes       | -         | -         | -           |
| Apply to a job, withdraw, track status                        | -       | Yes       | -         | -         | -           |
| Download / delete own data (GDPR)                             | -       | Yes       | -         | -         | -           |
| See candidates, applications, documents                       | -       | -         | Read only | Yes       | Yes         |
| Create / edit / publish / close / delete job offers           | -       | -         | -         | Yes       | Yes         |
| Change application status, add internal notes                 | -       | -         | -         | Yes       | Yes         |
| Manage success stories, home slides, categories, destinations | -       | -         | -         | Yes       | Yes         |
| Export applications to CSV / Excel                            | -       | -         | -         | Yes       | Yes         |
| Create / disable admin accounts, assign roles                 | -       | -         | -         | -         | Yes         |
| Global settings (cooldown period, upload limits), audit log   | -       | -         | -         | -         | Yes         |

- The first super admin is created by a seed script from environment variables.
- There is no public sign-up for admins.

## 3. Candidate profile

| Group              | Fields                                                                                                                                                           | Rules                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Identity           | First name, last name, gender, date of birth, nationality, country of residence, city, phone (with country code), WhatsApp                                       | Must be 18 or older                                                                     |
| Passport           | Number, issuing country, issue date, expiry date                                                                                                                 | Warn if it expires in less than 6 months; block applying if expired                     |
| Profile            | Current profession, years of experience, education level, languages with level (English, French, Arabic, Italian, Polish, German...), driving licence categories |                                                                                         |
| Documents          | CV, passport scan, ID photo, diplomas and certificates                                                                                                           | CV: PDF/DOCX, max 5 MB, required. Passport scan: PDF/JPG/PNG, required. Others optional |
| Cruise-ship extras | STCW basic safety training, seaman's book, medical certificate (PEME/ENG1), previous sea experience                                                              | Shown only for cruise jobs                                                              |
| Consent            | GDPR / data-processing checkbox                                                                                                                                  | Date of consent stored                                                                  |

The application form shows an anti-scam notice: "we never ask candidates for money to apply".

## 4. Job offers

### 4.1 Fields

Title, slug, destination, category, employer name (optional, can be hidden), description, requirements, benefits (accommodation, transport, meals), salary min/max + currency + period, contract duration, working hours, number of positions, required languages, application deadline, cover image, status, "featured" flag.

- **Destination**: Malta, Poland, Cruise ship. Stored as a table so new countries can be added. Built-in codes: `MALTA`, `POLAND`, `CRUISE_SHIP`.
- **Status**: Draft, Published, Closed, Archived (`DRAFT`, `PUBLISHED`, `CLOSED`, `ARCHIVED`).

### 4.2 Availability rules

1. Only Published jobs whose deadline has not passed are visible.
2. A job closes automatically when its deadline passes or when the hired count reaches the number of positions.
3. Delete is a soft delete: the job is kept for history and existing applications.

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

## 7. Other features

### 7.1 Home page

Animated hero slider (Malta, Poland, cruise ship slides managed by admin), job search bar, animated counters, destinations, categories, latest jobs, "How it works" in 3 steps, success-stories carousel, testimonials, FAQ, contact form, job-alert subscription.

A success story has a photo, name, job, destination, visa date and short quote. It is published only with the candidate's written consent.

### 7.2 Jobs page

Filters by destination, category, salary and language; full-text search; pagination; shareable job URLs with SEO meta and JSON-LD `JobPosting`.

### 7.3 Notifications

Email on registration, verification, application received, every status change, and new jobs matching job alerts.

### 7.4 Admin dashboard

KPIs (open jobs, applications this month, visas approved, by destination), a Kanban/table view of applications, candidate search, document preview, CSV export, audit log.

### 7.5 Security and legal

Rate limiting, CAPTCHA (Cloudflare Turnstile) on register/apply/contact, private files, GDPR data export and account deletion, privacy policy and terms pages.

## 8. Azure for Students constraints

- 100 USD credit for 12 months; when it runs out the subscription is disabled.
- PostgreSQL is free only for one B1ms server with 32 GB storage (750 h/month). Never bigger, never a second server.
- Allowed regions, vCPU quota, budget support and the CI/CD identity option are recorded in [00-environment.md](00-environment.md). Always follow them.
- Free for 12 months on this subscription (confirmed in the portal): PostgreSQL B1ms 750 h + 32 GB, one Container Registry Standard, Key Vault 10,000 transactions, Blob 5 GB hot LRS, 15 GB outbound bandwidth. Stay inside these sizes.
- Keep min replicas at 0 and max at 2; set a Log Analytics daily cap; only ONE Container Apps environment (quota); region `italynorth`.
- Outbound SMTP port 25 is blocked: use port 587.
