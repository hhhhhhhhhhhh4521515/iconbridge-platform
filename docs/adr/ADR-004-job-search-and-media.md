# ADR-004: Job search, availability and public media

- Status: accepted
- Date: 2026-10-10

## Context

Candidates search a small catalogue (hundreds of offers at most) written in English, French or Arabic, often from a phone and with approximate spelling. Offers must disappear the moment they expire. Job covers are public images. The platform runs on one small PostgreSQL server and up to two API replicas.

## Decision

| Topic                            | Choice                                                                                                   | Reason                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Search engine                    | PostgreSQL only: the existing `tsvector` column plus `pg_trgm` on the title                              | No extra service to pay for or operate; the catalogue is small                                                    |
| Text matching                    | Prefix `tsquery` built from the letters and digits of the query, OR trigram word similarity on the title | Prefixes give search-as-you-type and cover plurals in the description; trigrams cover plurals and typos in titles |
| Query building                   | The query text is reduced to words by the API and passed as a bound parameter                            | User text can never become `tsquery` syntax or SQL                                                                |
| Visibility                       | One SQL fragment (`OPEN_JOB_SQL`) used by every public query                                             | The rule cannot differ between the list, the detail, the counters and the statistics                              |
| Automatic closing                | Scheduled task in the API with a transaction-level advisory lock                                         | No extra scheduler resource; safe with two replicas; the lock is released even if the instance dies               |
| Scheduled task and scale to zero | Public queries do not depend on the task                                                                 | With min replicas 0 the task does not run while nobody visits; visibility is still correct                        |
| Pagination                       | Page and page size with a total                                                                          | The catalogue is small and the site shows page numbers; cursors add nothing here                                  |
| Slugs                            | Generated, stable once published, kept by deleted jobs                                                   | Shared links and search-engine results keep working and never point to another offer                              |
| Deleting catalogue entries       | Delete when unused, deactivate when used                                                                 | Admins get one "remove" action that cannot break existing jobs                                                    |
| Cover images                     | Re-encoded to WebP at 1200 px by sharp; format detected from the bytes                                   | Smaller pages; a renamed file or a script cannot be stored; EXIF (GPS) is removed                                 |
| Public media                     | Blob container `public-media` with anonymous blob read, content hash in the file name                    | Images are served by storage, not by the API, and can be cached for a year                                        |
| Statistics cache                 | In memory, 10 minutes, per instance, plus an HTTP cache header                                           | Four counts; a shared cache is not worth a new dependency                                                         |

## Consequences

- **pg_trgm must be allow-listed on Azure** before the migration runs: server parameter `azure.extensions` must include `PG_TRGM`. This belongs to the Terraform step.
- **The storage account must allow anonymous blob access** for the `public-media` container, or the images must be served through a CDN or a proxy and `PUBLIC_MEDIA_BASE_URL` set accordingly. Candidate documents must go to a separate private container; this one must never hold them.
- Typos are tolerated on titles only. A typo in a word that appears only in a description finds nothing.
- Search does no language-aware stemming ("ran" does not find "run"). Prefix matching covers the common plural cases.
- Salaries in different currencies or periods are compared as plain numbers. The salary filter and sort are meaningful with the `currency` filter.
- The counters can be up to 10 minutes old, and two replicas can show slightly different values for a while.
- A job can stay `PUBLISHED` in the database for up to 15 minutes (or longer when the API is scaled to zero) after it stopped being visible. The back office shows the stored status.
- A soft-deleted job cannot be restored through the API yet.
- Azurite is started with `--skipApiVersionCheck`, because the Azure SDK targets a newer API version than the emulator supports.
