# ADR-006: Back office, exports and scheduled tasks

- Status: accepted
- Date: 2026-10-11

## Context

Recruiters move applications through nine statuses, write notes, export lists and publish success stories. Candidates must be told of every step without ever seeing internal remarks. The API will run on Azure Container Apps with zero minimum replicas, so nothing inside the process can be relied on to run on a schedule.

## Decision

| Topic                       | Choice                                                                                                                                                                    | Reason                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| State machine               | A function in `packages/shared`, strict: one step forward or Rejected                                                                                                     | One definition for the API and the interface; a mis-click cannot skip the interview or the visa                                             |
| Reopening                   | Super admin only, back to Under review                                                                                                                                    | Rejected and Withdrawn stay final for daily work, with an escape for mistakes                                                               |
| Hired count                 | Incremented on Deployed, in the same transaction, with a conditional update                                                                                               | The specification closes a job when hired count reaches positions; the condition makes over-hiring impossible even with concurrent requests |
| Two texts per change        | `comment` (internal) and `messageToCandidate` (public) in separate columns                                                                                                | A recruiter can speak freely in one and deliberately in the other; nothing internal can leak by accident                                    |
| Audit of status changes     | Written inside the transaction by the service, not by the interceptor                                                                                                     | The entry exists if and only if the change exists, also in bulk                                                                             |
| Bulk change                 | One transaction per application, partial success reported                                                                                                                 | One refused application should not block ninety-nine valid ones                                                                             |
| Exports                     | Built in memory with a 5 000-row limit; CSV by hand, XLSX with exceljs                                                                                                    | Small volumes; no file ever touches disk or storage                                                                                         |
| Passport numbers in exports | Masked column by default; clear column only for a super admin who sets a separate flag; always logged                                                                     | Two deliberate actions and a trace for the most sensitive export                                                                            |
| Spreadsheet formulas        | Cells starting with `= + - @` get a leading apostrophe, except plain signed numbers and phone numbers                                                                     | Candidate-supplied text must not execute on a recruiter's computer                                                                          |
| Candidate detail            | Shows the clear passport number and writes an audit entry per view                                                                                                        | Recruiters need the number for visa files; access is traceable                                                                              |
| Story names                 | First name and last initial unless `showFullName`                                                                                                                         | Privacy by default; the full name needs explicit consent                                                                                    |
| Consent                     | Required to publish, checked by the API and by a database constraint; file in private storage                                                                             | The specification requires written consent; the constraint holds whatever code writes                                                       |
| Job alerts                  | Double opt-in; one row per subscription; a (subscription, job) table records what was sent                                                                                | Nobody can subscribe another person; a failed email is retried; nothing is sent twice                                                       |
| Alert sending               | A batch, not an event on publish                                                                                                                                          | No queue to operate; survives restarts; groups several jobs in one email                                                                    |
| Scheduled work              | Tasks callable from a CLI entry point (`dist/cli.js`), run in Azure by a scheduled Container Apps Job; in-process scheduler kept for local use behind `SCHEDULER_ENABLED` | With scale to zero, in-process timers do not fire; a job runs on time and costs seconds of compute                                          |
| Mutual exclusion            | PostgreSQL advisory locks per task                                                                                                                                        | Scheduler, CLI and replicas can overlap safely without another service                                                                      |

## Consequences

- **Infrastructure**: a Container Apps Job on a cron schedule (every 15 minutes) running the API image with the command `node dist/cli.js all` and the same environment and identity as the API; `SCHEDULER_ENABLED=false` on the API.
- The job consumes compute every 15 minutes even when the site is idle. A few seconds per run; raise the interval if the credit matters more than the delay of alerts and of status tidying.
- While a long task runs, it holds one database connection idle in a transaction for the lock. Tasks must stay well under the 10-minute limit set in `TaskLockService`.
- A recruiter cannot fix a wrong click by stepping back; they reject (final) or ask a super admin. If corrections become frequent, add an explicit "undo last change" for a short window.
- `hired_count` only grows. Reopening or erasing a deployed application does not decrement it.
- Emails are sent after the commit, one per change; a mail outage leaves the change in place without notice to the candidate. The timeline still shows it.
- Bulk changes send one email per application in sequence; 100 applications mean 100 SMTP round trips in one request.
- Exports read live profile data, not the snapshot taken at apply time: they show current contact details.
- Erased candidates remain as anonymous rows in dashboard counts, by design.
- Contact messages are stored but have no back-office screen yet; they reach the agency by email.
- Job alert emails are not rate limited per subscriber beyond one email per batch run.
