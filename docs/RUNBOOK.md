# Runbook

Operations of the production site on Azure (`rg-iconbridge-prod`, Italy North). Every change goes through a pull request, CI and a deployment approved in GitHub; nothing here pushes images or edits the apps by hand, except the emergency steps marked as such.

Names used below:

| What                   | Name                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Resource group         | `rg-iconbridge-prod`                                                                |
| Web app / API          | `ca-iconbridge-web-prod-itn` / `ca-iconbridge-api-prod-itn`                         |
| Jobs                   | `caj-iconbridge-{migrate,tasks,backup}-prod-itn`                                    |
| Database               | `psql-iconbridge-prod-itn` (PostgreSQL 16, B1ms), database `iconbridge`             |
| Storage account        | `sticonbridgeproditn` (containers `candidate-documents`, `public-media`, `backups`) |
| Key Vault              | `kv-iconbridge-prod-itn`                                                            |
| Action group of alerts | `ag-iconbridge-prod-itn`                                                            |

Commands assume `az login` on the owner's account and the repository root (`set -a; . ./.azure-context; set +a` for the subscription id).

## Deploy

1. Open a pull request from `feat/<task-name>`; CI (`ci.yml`), the security scans and, for `infra/**`, the Terraform plan comment must be green.
2. Squash-merge. CI runs again on `main`; then `deploy.yml` builds, scans (trivy) and pushes the four images (`iconbridge-api`, `-migrate`, `-web`, `-backup`) tagged with the commit.
3. Approve: Actions → the Deploy run → **Review deployments** → `production` → Approve. An infrastructure change also waits in `infra.yml` (apply after approval): approve the infrastructure run first when a deployment depends on it.
4. The run applies the migrations (job), updates the API, the web app and the jobs, waits for the new revisions and runs the smoke test. Its summary shows the commit, revisions and duration.

A merge that only changes `docs/**` or `*.md` deploys nothing. Details: [CICD.md](CICD.md).

**Infrastructure that needs a role assignment** (the CI identities cannot assign roles): `infra.yml` fails with `AuthorizationFailed`. Apply it from the owner's machine on an up-to-date `main`:

```bash
make tf-plan ENV=prod   # read the plan
make tf-apply ENV=prod
```

## Roll back

- **Automatic**: if the smoke test fails, the deploy job puts back the previous images of the apps and jobs and checks them again (proved on 19 October 2026, journal).
- **To a known version** later: Actions → Deploy → **Run workflow**, `image_tag` = the full commit SHA of the version to go back to (its images are still in the registry), then approve. Nothing is rebuilt.
- **Migrations are never undone**: they are written to work with the previous version (CLAUDE.md). A migration that destroyed data is a restore (below), not a rollback.
- Find the running version: `curl -s https://<site>/api/health/ready` (both apps report their commit).

## Alerts

Alerts email the owner through the action group `ag-iconbridge-prod-itn`, never through the app's outbox (ADR-019): API 5xx, database CPU, storage availability, scheduled tasks, abandoned emails, failed backup, the budget, and the availability tests when they are switched on.

### Verify the email receiver (once per address)

Azure Monitor sends **"Action required: Verify your email for Azure Monitor action group"** when an email receiver is saved. The code must be entered **within 30 minutes**; an unverified receiver gets **no alert and no test notification**, although the portal still shows it "Enabled" and the alert history shows "ActionsTriggered".

Seen on 20 October 2026: the forced-error alert fired at 01:01 UTC, but no email arrived because the verification email of 01:27 (local time) had not been answered.

1. Azure portal → **Monitor** → **Alerts** → **Action groups** → `ag-iconbridge-prod-itn`.
2. Notifications → the email receiver `owner`: status **Unverified** → **Resend** (re-saving the action group with Terraform does not reliably send a new code).
3. Open the email, enter the code within 30 minutes; the status becomes **Verified**.

The verification holds for that address across every action group of the tenant: redo it only after changing `owner_email` (Terraform) or adding a receiver.

### Check that alerts arrive

Test notifications (`az monitor action-group test-notifications create`, the portal's **Test** button) answer `Conflict: Free subscription not supported` on this subscription. Fire a real alert instead:

1. Sign in on the site as a super admin (`/en/login`) and check that `/en/admin` opens.
2. In that tab, open the developer tools (F12 → **Console**) and run six forced errors (each audited as `diagnostics.forced_error`; the session cookie is HttpOnly, so the page itself makes the calls):

   ```js
   for (let i = 1; i <= 6; i++) {
     const r = await fetch('/api/v1/admin/diagnostics/error', {
       method: 'POST',
       credentials: 'include',
     });
     console.log(i, r.status);
   }
   ```

   `401`: the 15-minute access token expired, reload and run again. `403`: the account is not a super admin.

3. Expect six `500`, then **"Fired: Sev1 alert-api-5xx-prod-itn"** about 3 minutes later and **"Resolved"** about 10 minutes after the errors. Proved on 23 October 2026: errors at 12:29, Fired at 12:32, Resolved at 12:39 (Tunis time).

### When an alert fires

| Alert                    | First look                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alert-api-5xx`          | Application Insights → Failures (operation and exception type); logs by `traceId`: workbook "IconBridge Jobs – operations"                         |
| `alert-postgres-cpu`     | Database → Monitoring → Query Performance Insight; a slow query after a deployment means rolling back                                              |
| `alert-storage-failures` | Storage account → Insights → Failures; Azure status page for Italy North                                                                           |
| `alert-tasks`            | `az containerapp job execution list -g rg-iconbridge-prod -n caj-iconbridge-tasks-prod-itn -o table`, then the execution's logs; database stopped? |
| `alert-emails-abandoned` | `email_outbox` rows with status `FAILED`; the Azure Communication Services quota (10 an hour) and the domain                                       |
| `alert-backup`           | [Backups](#backups): run the job again and read its logs                                                                                           |
| Budget 50 / 80 / 100 %   | Cost Management → Cost analysis by resource; availability tests left on? A minimum replica above 0?                                                |

## Backups

Two independent layers ([ADR-020](adr/ADR-020-backups.md)):

| Layer                        | What                                                                                                                | Kept                                                   | Restores to                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| PostgreSQL automated backups | Daily snapshots and transaction logs, by Azure (locally redundant)                                                  | 7 days                                                 | Any second of those 7 days, as a **new server** |
| Weekly logical backup        | `pg_dump` (custom format) by `caj-iconbridge-backup-prod-itn`, Sunday 03:00 UTC, to the private `backups` container | 30 days (lifecycle policy), then 7 days of soft delete | Any PostgreSQL 16 database, e.g. local          |
| Candidate files and media    | Blob soft delete (deleted or overwritten files)                                                                     | 7 days                                                 | The same container                              |

Check the automated backups: `az postgres flexible-server show -g rg-iconbridge-prod -n psql-iconbridge-prod-itn --query backup` (`backupRetentionDays: 7`, `earliestRestoreDate`).

### Run a backup now

```bash
az containerapp job start -g rg-iconbridge-prod -n caj-iconbridge-backup-prod-itn
az containerapp job execution list -g rg-iconbridge-prod -n caj-iconbridge-backup-prod-itn -o table
az storage blob list --auth-mode login --account-name sticonbridgeproditn -c backups \
  --query "[].{name:name, size:properties.contentLength, created:properties.creationTime}" -o table
```

The execution prints one line: `{"backup":"iconbridge-<UTC time>.dump","bytes":…,"seconds":…,"ok":true}`.

### Restore a weekly backup (tested)

`scripts/restore-backup.sh` downloads a blob (or takes a local file) and runs `pg_restore` of the backup image into the target database. Test it on a local database first, never straight on production:

```bash
docker build -t iconbridge-backup:local infra/backup
pnpm infra:up
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE restore_check"'
scripts/restore-backup.sh \
  https://sticonbridgeproditn.blob.core.windows.net/backups/iconbridge-<UTC time>.dump \
  "postgresql://<user>:<password>@localhost:5432/restore_check"
```

Downloading needs **Storage Blob Data Reader** on the account (the owner has Contributor). The dump holds personal data: delete the local copy and the local database after the check (`DROP DATABASE restore_check`).

Tests (journal): 20 October 2026, the development database (863 KB) restored in 2 s with identical row counts in all 23 tables, and the API started on it; 23 October 2026, the same through the backup image's upload path; 25 October 2026, the first scheduled backup on Azure (03:00 UTC, 83 KB, 4 s); 27 October 2026, a manual run on Azure, downloaded with this script and restored locally in 2 s (23 tables, 13 migrations, the same open jobs and success stories as the public site, passport numbers still encrypted), then the local database dropped.

**Into production** (data loss, owner's decision): prefer the point-in-time restore when the loss is less than 7 days old. Otherwise create an empty database on the server (`az postgres flexible-server db create … --database-name iconbridge_restored`), restore into it from a machine allowed by the server's firewall (`admin_ip_addresses`), point the `database-url` secret at it, restart the API revision, and keep the old database until the site is checked. Writes made between the backup and the switch are lost.

### Point-in-time restore (last 7 days)

Azure restores into a **new server** (billed while it exists; B1ms within the free hours if short-lived):

```bash
az postgres flexible-server restore -g rg-iconbridge-prod \
  --name psql-iconbridge-restore-itn --source-server psql-iconbridge-prod-itn \
  --restore-time "2026-10-23T08:00:00Z"
```

Then either copy what was lost from the new server, or point the apps at it: update the `database-url` secret (host name), restart the API revision and the jobs, and import the server into Terraform or recreate the old name. Delete the restore server when done (`az postgres flexible-server delete`, owner only).

### RPO and RTO

| Incident                                         | Recovery point (data lost at most)                | Recovery time (measured or expected)                                                              |
| ------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bad deployment                                   | none                                              | 3–6 minutes (automatic rollback, or `image_tag`)                                                  |
| Rows deleted or corrupted, noticed within 7 days | about 5 minutes (transaction logs)                | 30–60 minutes: new server about 15–20 minutes, then secret and restart                            |
| Server lost, or noticed after 7 days (within 30) | up to 7 days (last weekly dump)                   | about 30 minutes: new server or database, `pg_restore` (2 s for 1 MB locally), secret and restart |
| Candidate file deleted                           | none within 7 days                                | minutes: undelete the blob (soft delete)                                                          |
| Region lost                                      | everything since the last copy taken out of Azure | hours: no geo-redundancy within the budget (ADR-013)                                              |

## Costs and the budget

Both apps keep one warm replica, so the site never cold-starts ([ADR-022](adr/ADR-022-warm-replicas.md)). Expected cost: 30 to 37 USD a month, almost all Container Apps memory and idle vCPU; the budget `budget-iconbridge-prod-itn` (40 USD) emails the owner at 20, 32 and 40 USD.

- **See the bill**: portal → **Cost Management** → **Cost analysis**, scope `rg-iconbridge-prod`, group by **Meter**. "Idle Usage" should be most of the vCPU; much "Active Usage" means the replicas are busy (traffic, or something polling the site).
- **Remaining credit**: portal → search **Education** → **Overview**. Credit divided by the month's cost is how long the site stays up: the spending limit stops every resource when the credit is spent.
- **Back to scale to zero** (saves about 30 USD, brings back a 20–60 s wait for the first visitor): set `min_replicas = 0` in `api_size` and `web_size` (`infra/terraform/envs/prod/variables.tf`) through a pull request; `infra.yml` applies it after approval.
- **Cheaper middle ground**: the API at `cpu = 0.25, memory = "0.5Gi"` (about 7.5 USD less), or `min_replicas = 1` for the web app only.

## Domain and email domain

The site is `https://iconbridgerecruitment.com`; `www.` and the default Azure address redirect to it ([ADR-023](adr/ADR-023-custom-domain-and-email-domain.md)). Emails leave from `noreply@iconbridgerecruitment.com` once the email domain is verified. DNS is at Cloudflare; every record of `terraform -chdir=infra/terraform/envs/prod output -json dns_records` must stay **DNS only** (grey cloud).

- **Check**: `curl -sI https://www.iconbridgerecruitment.com/en | grep -i location` (308 to the apex), `curl -s https://iconbridgerecruitment.com/api/health/ready`, and `az containerapp hostname list -g rg-iconbridge-prod -n ca-iconbridge-web-prod-itn -o table` (each name `SniEnabled` with a certificate).
- **Certificates** are Azure's managed ones and renew themselves while the A, CNAME and `asuid` records stay unchanged and unproxied. If a renewal fails (portal: environment → **Certificates**), check the records with `dig`, then bind again (DEPLOYMENT.md, "Custom domain", step 3).
- **Site down on the domain but up on the Azure address**: a DNS change at Cloudflare (proxy switched on, record edited or deleted). Put the records back as `dns_records` lists them.
- **Emails refused or in spam**: `az communication email domain show -g rg-iconbridge-prod --email-service-name ecs-iconbridge-prod-itn --name iconbridgerecruitment.com --query verificationStates`; every state must be `Verified`. To fall back while it is fixed: `use_email_domain = false` in `production.auto.tfvars` (pull request), and emails leave from the Azure-managed domain again (10 an hour).
- **Sending limit**: starting limit 100 emails an hour (`EMAIL_HOURLY_QUOTA`); raising it is a support request (DEPLOYMENT.md, "Email on the site's domain", step 4), then `email_hourly_quota` in `production.auto.tfvars`.

## Rotate secrets

Secrets live in Key Vault; the apps read them when a revision starts. After any change, restart:

```bash
for app in ca-iconbridge-api-prod-itn ca-iconbridge-web-prod-itn; do
  rev=$(az containerapp show -g rg-iconbridge-prod -n $app --query properties.latestRevisionName -o tsv)
  az containerapp revision restart -g rg-iconbridge-prod -n $app --revision "$rev"
done
```

Jobs read the new value at their next execution.

| Secret                                       | How                                                                                                                                                                                                         | Effect                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `jwt-access-secret`                          | `terraform -chdir=infra/terraform/envs/prod plan -replace=random_password.jwt_access -out=tfplan`, then `make tf-apply`, then restart                                                                       | Access tokens (15 minutes) become invalid; browsers refresh silently (refresh tokens are in the database) |
| `revalidate-secret`                          | Same with `random_password.revalidate`; restart **both** apps together                                                                                                                                      | Until both run the new value, cache revalidation fails (the site refreshes every hour anyway)             |
| `db-admin-password` and `database-url`       | Same with `random_password.db_admin`: Terraform changes the server's password and the URL; restart at once                                                                                                  | New database connections of old revisions fail until the restart (about a minute)                         |
| `turnstile-site-key`, `turnstile-secret-key` | Cloudflare → Turnstile → the widget → Rotate secret key; `az keyvault secret set` as in [DEPLOYMENT.md](DEPLOYMENT.md#3-external-secrets); restart. The site key is built into the web image: deploy again  | Sign-up and contact forms fail between the rotation and the restart                                       |
| `seed-admin-password`                        | Only used to create the first super admin: change that account's password in the site instead                                                                                                               | none                                                                                                      |
| `passport-encryption-key`                    | **Do not rotate.** Stored passport numbers can only be read with this key, and the API has no re-encryption with key versions. If it leaked: write a re-encryption migration first (ADR-002, `FieldCipher`) | Rotating it without that makes every passport number unreadable                                           |
| `appinsights-connection`                     | Not a secret in the strict sense (ingestion only); regenerate by recreating the component if abused                                                                                                         | none                                                                                                      |

The `-replace` applies run from the owner's machine (`make tf-apply`), because the plan identity of CI cannot replace a resource without a code change. Record the rotation in the journal (date, secret, reason; never the value).

## Add an admin

There is no public sign-up for back-office accounts (SPEC).

1. Sign in as a super admin → **Back office** → **Users and roles** → **Invite a user**: email, role (`VIEWER`, `COUNTRY_AGENT`, `RECRUITER` or `SUPER_ADMIN`), and for a country agent his countries (nationalities). Audited as `admin_user.create`.
2. Either **Send an invitation email** (set-password link, counted in the hourly email limit), or **Set the password now**: no email, give the password to the person by another channel; it is never shown again, and the person must choose a new one at the first sign-in (nothing else works before).
3. Change a role and the countries (**Role**, or the countries column), set a new password for someone who lost access (**Set a password**: signs the account out everywhere, audited as `admin_user.set_password` without the password), sign someone out everywhere (**Log out everywhere**) or disable the account from the same page. Give `SUPER_ADMIN` sparingly: it alone sees clear passport numbers in exports and can change settings.

**Country agents** (ADR-024): `bihi@iconbridgerecruitment.com` (Morocco, `MA`) and `majdi@iconbridgerecruitment.com` (Tunisia, `TN`). Their mail is forwarded by Cloudflare Email Routing (DEPLOYMENT.md, "Mail for agent addresses"): if an agent receives no reset email, check the routing rule and the destination in Cloudflare, then the outbox. An agent who sees too many or too few candidates: check his countries in **Users and roles** and the candidates' **nationality** (country of residence does not count).

If no super admin can sign in any more, the migration job's seed creates the first super admin only when none exists: reset the password of the existing one with **Forgot password** on the sign-in page (the email goes to its address).

## Reset the waiting period for a candidate

A candidate may apply to the same job only once every 6 months (SPEC section 6, setting `REAPPLY_COOLDOWN_MONTHS`). When the agency decides a candidate must be able to apply again sooner (for example after a rejection by mistake), a **super admin** lifts the waiting period of that one application:

1. **Back office** → **Applications** → search the candidate → open the application.
2. The application must be **Deployed**, **Rejected** or **Withdrawn** (an application in progress still holds the job) and its period must still run.
3. **Lift the waiting period** → enter a reason (kept in the audit log; no personal data) → confirm.
4. The panel shows "Waiting period lifted on …". The candidate can apply at once from the job page; nothing is emailed. Their next application starts a new period.

Audited as `application.waive_cooldown` (who, when, reason): **Back office** → **Audit log**, filter `waive`. API: `POST /api/v1/admin/applications/{id}/waive-cooldown` with `{ "reason": "…" }` (super admin only; recruiters and viewers get 403). It cannot be undone; deleting the application (with a reason) has the same effect and also removes it.

## Stop and start the database

A stopped server costs no compute (storage is still billed) and Azure **starts it again after 7 days** on its own.

```bash
az postgres flexible-server stop  -g rg-iconbridge-prod -n psql-iconbridge-prod-itn
az postgres flexible-server start -g rg-iconbridge-prod -n psql-iconbridge-prod-itn
```

While it is stopped the site answers errors, the tasks job fails every 15 minutes (`alert-tasks` fires) and the weekly backup fails. Within the free 750 hours of B1ms a month, one server running all month (at most 744 hours) costs nothing: stopping saves credit only after the free year, or when another server (a point-in-time restore) runs at the same time.

## Destroy everything at the end of the internship

Deleting is final: export what must be kept first (a last weekly backup downloaded and stored outside Azure, encrypted, if the owner must keep the data; otherwise none, the data belongs to the candidates). Run from the owner's machine:

1. Disable the deploy and infrastructure workflows (Actions → workflow → Disable) so nothing recreates resources.
2. Remove `prevent_destroy = true` from `modules/database/main.tf` and `modules/storage/main.tf` (deliberate edit, local only).
3. `make tf-destroy ENV=prod` (type `prod`). This deletes the apps, jobs, database, storage, Key Vault (soft-deleted with purge protection: its name stays reserved 7 days), registry, email service, alerts, workbook, budget and the resource group's contents.
4. `make tf-destroy ENV=github`: the three app registrations of GitHub Actions and their roles.
5. Remove `prevent_destroy` from `bootstrap/main.tf`, then `cd infra/terraform/bootstrap && terraform destroy`: the Terraform state storage (last, it holds the state of the others).
6. Check nothing is left: `az group list --query "[?starts_with(name, 'rg-iconbridge')]" -o table` and Cost Management for the next days.
7. In GitHub: delete the `production` environment's secrets and the repository secrets (`AZURE_*`, `TF_VARS_PROD`, `TURNSTILE_SITE_KEY`).
