# ADR-010: Historical results, and deleting candidates and applications

- Status: accepted
- Date: 2026-10-11

## Context

IconBridge placed candidates before this platform existed, so its counters understated the agency. The manager also needs to remove a candidate or an application created by mistake. Both touch figures that people trust (the home page, the dashboard) and personal data.

## Decision

| Topic                        | Choice                                                                                                                                                                                 | Reason                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Where history lives          | Its own table `historical_figures` (metric, year, destination, value, note)                                                                                                            | A figure typed by hand is never counted as, or confused with, an application. Removing the history changes no live data                    |
| Shape of a figure            | Visas approved, candidates deployed and candidates registered are per year and destination; partner companies and countries served are single global figures (no year, no destination) | Companies and countries cannot be added year after year without counting the same one twice                                                |
| One figure per place         | Unique index on (metric, year, destination) with `NULLS NOT DISTINCT`; `PUT` replaces the value                                                                                        | Saving twice must not add twice. The index also covers the global figures, whose year and destination are null                             |
| Totals                       | `ResultsService` returns `platform` and `history` separately; the dashboard adds them and shows the split; `GET /stats` returns the sum                                                | One place computes each side. The split stays visible to every back-office role                                                            |
| Countries                    | The larger of "active destinations" and "countries served", not their sum                                                                                                              | The historical figure is the total number of countries; Malta and Poland would be counted twice                                            |
| Partner companies (platform) | Distinct employer names of jobs that were published, hidden names included                                                                                                             | It is a count, not a list; the historical figure is added to it                                                                            |
| Public cache                 | The 10-minute cache of `GET /stats` is emptied when a figure changes or a record is deleted                                                                                            | A figure entered now must not wait. The home page itself keeps its data up to one more minute                                              |
| Who edits history            | Super admin only (`MANAGE_SETTINGS`); every change audited with the value before and after                                                                                             | These figures appear publicly under the agency's name                                                                                      |
| Who deletes                  | Super admin; a recruiter only when the setting `ALLOW_RECRUITER_DELETE` is on (off by default). `GET /admin/capabilities` tells the screens                                            | The manager decides whether recruiters get a destructive action. The API checks the setting on every deletion                              |
| Deleting a candidate         | The GDPR erasure of the account (`AccountService.eraseCandidate`): files first, then personal data; applications stay as anonymous rows                                                | One erasure to maintain and test. Counts and `hiredCount` stay right because the rows remain                                               |
| Deleting an application      | The row is removed with its history and notes; documents stay with the candidate; `hiredCount` is not decreased                                                                        | The position of a deployed candidate was really filled. The waiting period disappears by itself: it is computed from existing applications |
| Reason and audit             | A reason of 5 to 500 characters is required; the audit entry holds who, when, the reason and counts                                                                                    | Accountability without copying personal data into a log that is never erased                                                               |
| Confirmation                 | A dialog lists what will be removed and what will not change, and needs the word DELETE                                                                                                | Same gesture as deleting one's own account in the candidate area                                                                           |

## Consequences

- Deleting an application lowers the application counts of the dashboard: it is a real removal. Deleting a candidate does not, except that applications in progress become Withdrawn.
- The reason is free text typed by a person. The dialog asks not to write personal data in it; nothing enforces that.
- With several API instances, each one keeps its own `GET /stats` cache: only the instance that received the change answers the new figure at once, the others within 10 minutes.
- "Visas approved per year" of the platform uses the year the visa was approved, or the year of the application when that date is unknown.
- `historical_figures_metric_year_destination_key` is created by hand in the migration; `schema.prisma` declares a plain unique index of the same name so that Prisma reports no drift.
