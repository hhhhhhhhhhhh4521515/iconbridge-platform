# ADR-020: Database backups and restore

Date: 2026-10-23. Status: accepted.

## Context

Prompt 14 asks to confirm the automated backups of PostgreSQL, to add a weekly logical backup kept 30 days in a private container, to test a restore, and to state the recovery point and time (RPO, RTO), within 15 USD a month. The database holds candidates' personal data (passport numbers encrypted by the API, ADR-002).

## Decisions

1. **Keep the automated backups of the Flexible Server: 7 days, locally redundant** (ADR-013). They give point-in-time restore to any second of the last 7 days, into a new server. Geo-redundant backups would double the backup storage and are not available on every region pairing; not worth it here.
2. **Weekly logical backup** by a Container Apps Job, `caj-iconbridge-backup-prod-itn`, Sunday 03:00 UTC: `pg_dump --format=custom` (compressed, restorable table by table), uploaded to the private `backups` container. It protects against what the automated backups do not cover: a mistake noticed after 7 days, the deletion of the server (its backups go with it), and it gives a copy that restores on any PostgreSQL 16, such as a laptop.
3. **Retention by a lifecycle policy**: blobs under `backups/` are deleted 30 days after creation, then kept 7 more days by the account's soft delete. About 4 to 5 dumps exist at a time.
4. **Own small image, `iconbridge-backup`** (`infra/backup`): Alpine 3.22 with `postgresql16-client` (the server's major version), `curl` and `jq`; user 1000. Built, scanned and deployed by `deploy.yml` with the other images and rolled back with them.
5. **Upload with curl and the managed identity, not azcopy.** The first version used azcopy 10.32.8: its binary embeds the Go standard library, and trivy found five fixable HIGH vulnerabilities in it a few weeks after the release, which would block every deployment until a new azcopy release. One dump is a single Put Blob (up to 5000 MiB), so the script asks the Container Apps identity endpoint for a Storage token and uploads with `curl --upload-file`, sending `Content-MD5` so the service checks the bytes it received. Alpine patches curl and PostgreSQL itself.
6. **Identity of the apps** (`id-iconbridge-prod-itn`), which already has Storage Blob Data Contributor on the account and reads `database-url` from Key Vault. A separate identity limited to the `backups` container would be tighter, but needs role assignments that only the owner can apply (the CI identities cannot assign roles); the API could already read and write every container, so the backup adds no new access.
7. **Failure alert** `alert-backup`: once a day over two days, any failed execution of the job (the script stops at the first error: dump, token, upload). Severity 2, same action group (ADR-019).
8. **Restore script** `scripts/restore-backup.sh <file or blob URL> <database URL>`: downloads with `az storage blob download --auth-mode login`, then `pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error` from the backup image, so nothing is installed on the machine.

## Consequences

- Cost: a few cents a month (about 1 MB a week of Hot storage, one job execution of a few seconds within the Container Apps free grant, one daily log alert at about 0.50 USD a month).
- RPO: about 5 minutes within 7 days (point-in-time restore), up to 7 days beyond, up to 30 days. RTO: 30 to 60 minutes. Details and procedures: docs/RUNBOOK.md.
- The dumps hold personal data: the container is private, there is no account key and no SAS; reading them needs a role on the account. Passport numbers stay encrypted inside the dump.
- Candidate files are not copied: the blob soft delete (7 days) covers mistakes; a lost region loses them.
- A backup taken while the database is stopped fails and raises the alert, as intended.
