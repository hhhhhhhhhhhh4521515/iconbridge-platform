# ADR-025: Closed jobs stay visible; a position is filled at Contract signed

Date: 2026-10-29. Status: accepted.

## Context

One rule, `OPEN_JOB_SQL` / `isJobOpen` (Published, not deleted, deadline ahead, positions left), decided both whether a job accepts applications and whether the public site shows it. A job whose deadline passed or whose positions were filled disappeared from the site, its page answered 404, and candidates who had seen it could not find it again. The owner wants closed jobs to stay visible, marked "Closed".

`hiredCount` went up when an application reached Deployed, the last step. For the agency a position is taken once the contract is signed: the visa steps that follow can take months, during which the position must not be offered to anybody else.

## Decision

1. **Two rules instead of one.**
   - **Listed** (`LISTED_JOB_SQL`, `isJobListed`): Published or Closed, published once, not deleted. What the public list and job pages show. Drafts and archived jobs stay off the site.
   - **Open** (`OPEN_JOB_SQL`, `isJobOpen`, unchanged): what accepts applications, what the job alerts, the "open jobs" counters and the filter counts are about.

   The public list returns listed jobs, open ones first, then the requested order; `open=true` keeps the open ones only (home page sections). Every public job carries `isOpen`. The web app shows a "Closed" badge and "This job is closed" instead of the Apply button, and leaves out the `JobPosting` structured data of a closed job. `ApplicationsService.evaluate` still answers `JOB_NOT_OPEN`, so `apply` refuses as before.

2. **A position is held from Contract signed** (`POSITION_HOLDING_STATUSES`: Contract signed, Visa processing, Visa approved, Deployed). Reading "moves out of Contract signed" literally would free the position when the visa process moves on, which is not what the agency means: the position is freed when the application leaves these steps (Rejected, a status change undone) or is deleted. Candidates cannot withdraw from Contract signed on, so withdrawal never frees one.

3. **`hiredCount` is recomputed, not incremented.** `JobPositionsService.sync(tx, jobId)` counts the holding applications of the job inside the transaction that changed one, after locking the job row, and writes the count. A change can never leave a wrong count behind, whichever path it took (status change, bulk change, undo, deletion, positions edited). Moving to Contract signed is refused with `NO_POSITION_LEFT` when the count already equals the positions.

4. **Automatic close and reopen, with a reason.** New column `jobs.close_reason` (`MANUAL`, `DEADLINE_PASSED`, `POSITIONS_FILLED`). `sync` closes a Published job when the count reaches the positions (`POSITIONS_FILLED`, audit `job.auto_close`) and reopens a job closed for that reason when the count drops below the positions and the deadline is ahead (audit `job.auto_reopen`). A job a recruiter closed (`MANUAL`) or whose deadline passed is never reopened by it. The `close-jobs` task writes the reason too.

5. **Migration**: the enum and the nullable column (additive), the reason of the jobs already closed guessed from their state (deadline passed, positions filled, else manual), and `hired_count` recomputed with the new rule (capped by `positions`, which the existing CHECK requires). The previous API version keeps working during the deployment: it ignores the column.

## Consequences

- Candidates and search engines find closed jobs; the sitemap lists them too. The jobs page can grow long: open jobs come first, and archiving removes a job from the site.
- A job with one position closes as soon as one contract is signed, and comes back by itself if that candidate is rejected later.
- Pages cached by the site follow at once: status changes, undo and deletions of applications now revalidate `jobs` as well as `stats`.
- The positions of a job cannot be set below its contracts signed, as before.
