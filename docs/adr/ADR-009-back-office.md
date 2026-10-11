# ADR-009: Back office of the web application

- Status: accepted
- Date: 2026-10-11

## Context

Recruiters, viewers and super admins need screens for jobs, applications, candidates, site content, users, settings and the audit log. The API already decides who may do what. The screens must not become a second, weaker copy of those rules, and must not put the tools of the back office (charts, editor, drag and drop) in the pages candidates load.

## Decision

| Topic                   | Choice                                                                                                                                              | Reason                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout                  | `app/[locale]/admin` with its own layout; the public pages moved into the route group `(site)`                                                      | The back office has a sidebar and no public header or footer; URLs of the public site do not change                                             |
| Languages               | English and French, in `messages/admin/{en,fr}.json`; `/ar/admin` redirects to `/en/admin`                                                          | Asked for two languages; a separate file keeps 500 back-office texts out of the public pages and out of the Arabic parity rule                  |
| Access                  | The proxy asks for the session marker; the shell reads `GET /auth/session`; menus and buttons follow `PERMISSIONS` from `packages/shared`           | One list of permissions for the API and the screens. Hiding is comfort: every call is checked by the API, and a forced write answers 403        |
| Passport numbers        | Masked for every role in every answer; `POST /admin/candidates/:id/reveal-passport` for recruiters and super admins, with an audit entry            | Before, opening a candidate showed the number to all three roles. Now a viewer can never obtain it, and each reveal is a deliberate, logged act |
| Undo of a status change | `POST /admin/applications/:id/undo-status`: the author, within 15 minutes, while it is still the current status; the history row is kept and marked | A mis-click on a pipeline that emails candidates needs a way back that leaves a trace. A correction email follows only if the first one left    |
| Order of the history    | `seq` (serial) on `application_status_history`                                                                                                      | Two changes can carry the same timestamp; "the last change" must be unambiguous                                                                 |
| Questions of a job      | JSON list on the job (text, yes/no, single choice; required; labels in three languages); copied onto the application when applying                  | The application keeps what was asked even if the recruiter edits the questions later. `checkAnswers` is shared by the API and the form          |
| Rich text               | Tiptap in the browser; `sanitize-html` in the API on writing and again on reading; plain texts stay plain                                           | The public page renders this HTML: the allow-list must not depend on when or by which client a text was written                                 |
| Tables                  | TanStack Table for sorting and selection of the page shown; paging and filters by the API                                                           | Lists can be long; the API already filters                                                                                                      |
| Kanban                  | dnd-kit; a drop asks the API to change the status; a move outside `allowedTransitions` is refused with a message before any call                    | The board cannot do what the state machine forbids, and the API would refuse it as well                                                         |
| Charts                  | Recharts, each with the same figures as a hidden list                                                                                               | Screen readers get the numbers                                                                                                                  |
| Pictures                | Cropped in the browser (react-easy-crop, canvas), then sent to the existing upload endpoints                                                        | The API still checks and re-encodes every picture                                                                                               |
| New success stories     | Placed first in the order                                                                                                                           | The home page shows the first twelve; a story published today should be among them without dragging it past the others                          |
| Social links            | `SOCIAL_*` settings, served by `GET /site-info`; the footer hides an empty one                                                                      | Edited from the dashboard instead of the code                                                                                                   |
| Browser tests           | A third Playwright project, `admin`, that runs after the two others                                                                                 | Each test signs several people in and sign-ins are rate-limited per address                                                                     |

## Consequences

- `GET /admin/candidates/:id` no longer writes a `candidate.view` audit entry: it shows nothing that the lists do not.
- The board shows the 100 newest applications of the current filters.
- A viewer does not see success stories and home slides in the menu: the API lets only recruiters and super admins read those managers.
- The public site keeps its data for up to a minute: a published job or story can take that long to appear. A job page that was never visited, or a search, shows it at once.
- Sign-in is limited to 5 attempts per minute per address. Locally every browser shares one address (`TRUST_PROXY_HOPS=0`), which is why the admin tests wait when they are told to.
- The browser tests leave disabled-able test accounts (`e2e-recruiter-*`, `e2e-viewer-*`) in the local database; they delete their job, story and candidate.
- The back office is laid out down to tablet width, not for phones.
