# ADR-021: Lifting the re-application waiting period

Date: 2026-10-23. Status: accepted.

## Context

A candidate may apply to the same job once every 6 months, whatever became of the last application (SPEC section 6). Prompt 14 asks for a way to reset that period for a candidate, as a super-admin action that is audited. Until now the only way was to delete the application, which also removes its history and notes.

## Decisions

1. **A mark on the application**, `applications.cooldown_waived_at` (nullable), rather than a per-candidate or per-job exception table. The rule already reads "the latest application to this job"; it now reads "the latest application to this job whose period was not lifted" (`ApplicationsService.evaluate`, the one place that decides who may apply). The eligibility endpoint and `apply` follow without other changes, and the application keeps its history.
2. **Only finished applications** (Deployed, Rejected, Withdrawn) whose period still runs. An application in progress still holds the job; lifting it would allow a second application in progress to the same job. Lifting twice, or after the period, is refused with `COOLDOWN_WAIVER_NOT_ALLOWED` (409).
3. **Super admins only**, through a new permission `WAIVE_COOLDOWN` in the privileges table (SPEC section 2): it changes a rule that the super admin also sets (`REAPPLY_COOLDOWN_MONTHS`).
4. **A reason is required** (5 to 500 characters) and goes to the audit entry `application.waive_cooldown` with the status and the time; no personal data. The candidate is not told: the job page simply offers Apply again.
5. **The next application starts a new period**, like any other.
6. **Not undoable.** A wrong lift is harmless until the candidate applies, and the application can still be withdrawn or rejected afterwards.

## Consequences

- Additive migration (one nullable column): it works with the API version still running during a deployment.
- Tests at the exact boundary (`cooldown-waiver.e2e-spec.ts`): allowed one millisecond before the end of the period, refused at the exact end; allowed and refused roles; the audit entry; nothing in candidate answers or emails. A browser test lifts the period from the back office.
- Statistics are unchanged: the application stays counted as it was.
