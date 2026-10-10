# ADR-005: Candidate documents, the re-application rule and erasure

- Status: accepted
- Date: 2026-10-10

## Context

Candidates upload passports and CVs, the most sensitive files of the platform. The specification has one hard business rule: a candidate may apply to the same job once every 6 calendar months, enforced in the API with a lock. Candidates have the right to a copy of their data and to erasure. Storage is Azurite locally and Azure Blob Storage with a managed identity in Azure.

## Decision

| Topic                | Choice                                                                                                                                              | Reason                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Storage access       | An abstract `StorageService`; one Azure implementation with two authentication modes (connection string, or account URL + `DefaultAzureCredential`) | The same code runs on Azurite, with an account key and with a managed identity; tests swap in an in-memory implementation |
| Download             | The API answers 302 to a SAS link: read-only, one blob, 5 minutes                                                                                   | Files go straight from storage to the browser; the API never proxies megabytes; the storage key is never exposed          |
| SAS type             | Service SAS with a key, user-delegation SAS with a managed identity                                                                                 | With an identity there is no key to leak or rotate                                                                        |
| File validation      | Format detected from the content (`file-type`), allow-list per document type                                                                        | A renamed executable is refused; the extension and the browser's declared type are untrusted                              |
| Blob names           | Random UUID under the profile id; original name only in the database                                                                                | Names cannot collide, be guessed, or carry personal data into storage logs                                                |
| Access to a document | `OwnershipGuard` for candidates (404 for others), role list for the back office, audit entry for each back-office download                          | A candidate cannot probe ids; staff access to identity documents is traceable                                             |
| Re-application rule  | Evaluated inside a transaction after two advisory locks (candidate, then candidate + job)                                                           | Two fast clicks cannot both pass; the candidate-level lock also makes the limit of active applications exact              |
| Date arithmetic      | date-fns `addMonths` on a UTC date                                                                                                                  | "6 calendar months" as people understand it (12 March to 12 September), independent of the server time zone               |
| Boundary             | Refused while `now < appliedAt + N months`; allowed at the exact instant                                                                            | Matches "can apply again from 12/09"                                                                                      |
| Eligibility          | One function serves both the eligibility endpoint and `apply`                                                                                       | The interface cannot promise what the API then refuses                                                                    |
| Time in tests        | An injectable `Clock`                                                                                                                               | The 6-month boundary is tested to the millisecond without fake timers                                                     |
| Snapshot             | Profile, languages and document metadata copied into the application, with the masked passport number                                               | Recruiters see what was submitted even if the profile changes; the snapshot adds no new copy of the passport number       |
| Error body           | `REAPPLY_COOLDOWN` carries `nextAllowedAt` at the top level and in `details`                                                                        | Asked for by the specification, and consistent with the common error format                                               |
| Erasure              | Files first, then one transaction that overwrites or deletes everything personal; anonymous application rows remain                                 | No orphaned personal file can survive; aggregate statistics stay correct                                                  |
| Erasure confirmation | The password                                                                                                                                        | The action is irreversible and a stolen session must not be enough                                                        |

## Consequences

- **Azure roles for the managed identity**: `Storage Blob Data Contributor` on the account (read, write, delete, create containers) and `Storage Blob Delegator` (to obtain the user-delegation key). The `candidate-documents` container must stay private.
- A download link keeps working for up to 5 minutes after it was issued, even if the document is deleted or the user is disabled in the meantime (unless the blob itself is gone).
- PDF and DOCX content is not scanned for malware or active content. Recruiters open files that candidates uploaded; a scanner (for example Microsoft Defender for Storage) is a later hardening step.
- Passport scans are stored as uploaded: unlike job covers they are not re-encoded, so image metadata is kept.
- A candidate who withdraws or is rejected still waits 6 months for the same job. This is the rule of the specification; the super admin can change the number of months, and 0 disables it.
- Advisory locks are held for the duration of the transaction (a few milliseconds). Requests of the same candidate queue; different candidates do not block each other.
- The candidate's view of an application hides the comment of each status change, because recruiters may write internal remarks there. If candidates should read a message, it needs its own field.
- The notice to recruiters goes to every active recruiter and super admin. With many recruiters this needs a preference or a digest.
- After erasure, internal notes about the person are gone and history comments are blank. Audit entries keep the anonymous user id.
- The export is built on request and streamed; with the limit of 30 documents of 5 MB it stays below 150 MB.
