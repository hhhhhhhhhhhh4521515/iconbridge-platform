# 00 - Environment report

Date: 2026-10-10. Status: **ready**. No Azure resource was created.

## Workstation

| Item             | Value                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| Host OS          | Windows 11 Home 10.0.26200 (64-bit), PowerShell 5.1                                 |
| Dev environment  | WSL2, Ubuntu 26.04.1 LTS, kernel 6.18.40.1 (installed in this step; it was missing) |
| Shell            | bash, Linux user `dev` (default WSL user)                                           |
| Project path     | `~/projects/iconbridge-platform` on the Linux filesystem (not OneDrive)             |
| Package managers | apt inside Ubuntu, winget on Windows (Docker Desktop only)                          |

## Tools

All tools run inside Ubuntu unless noted.

| Tool                       | Version                                             | Source                                      |
| -------------------------- | --------------------------------------------------- | ------------------------------------------- |
| git                        | 2.53.0 (Windows: 2.52.0)                            | apt                                         |
| nvm                        | 0.40.8                                              | official install script                     |
| Node.js                    | v22.23.3 (default); v20.20.2 also installed, unused | nvm                                         |
| corepack / pnpm            | 0.34.6 / 12.10.1                                    | corepack                                    |
| Docker Engine              | 29.8.2                                              | Docker Desktop for Windows, WSL integration |
| Docker Compose             | v5.5.1 (`docker compose` plugin)                    | Docker Desktop                              |
| Azure CLI                  | 2.91.0                                              | Microsoft apt repo                          |
| `containerapp` extension   | 1.3.0b5                                             | `az extension add`                          |
| Terraform                  | v1.16.5 (autocomplete installed)                    | HashiCorp apt repo                          |
| tflint                     | 0.64.0                                              | GitHub release                              |
| GitHub CLI                 | 2.102.0                                             | GitHub apt repo                             |
| jq / make / curl / openssl | 1.8.1 / 4.4.1 / 8.18.0 / 3.5.5                      | apt                                         |
| trivy                      | 0.75.0                                              | Aqua Security apt repo                      |
| checkov                    | 3.3.26                                              | pipx 1.8.0 (Python 3.14.4)                  |
| Claude Code                | 2.1.296                                             | official installer, `~/.local/bin/claude`   |

Verified: `docker run --rm hello-world` succeeds from Ubuntu.

Git: `init.defaultBranch=main`; `user.name` and `user.email` set from the GitHub account, using the private `users.noreply.github.com` address. Same identity applied to Windows git. `gh auth setup-git` configured as the credential helper.

GitHub CLI: logged in over HTTPS with scopes `repo`, `workflow`, `read:org`, `gist`.

## Azure subscription

| Item                     | Value                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active subscription      | Azure for Students, state Enabled                                                                                                                   |
| Offer                    | `AzureForStudents_2018-01-01`, spending limit **On**                                                                                                |
| Ids                      | stored in `.azure-context` (git-ignored), keys `ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`, `AZURE_LOCATION` |
| Role on the subscription | Owner                                                                                                                                               |
| Existing resources       | 0 resource groups, 0 PostgreSQL servers                                                                                                             |

### Region: `italynorth`

A policy assignment, "Allowed resource deployment regions", limits deployments to: `italynorth`, `germanywestcentral`, `spaincentral`, `austriaeast`, `centralindia`.

| Preferred region   | Allowed by policy | Container Apps | PostgreSQL B1ms                                   |
| ------------------ | ----------------- | -------------- | ------------------------------------------------- |
| francecentral      | no                | yes            | not checked                                       |
| **italynorth**     | **yes**           | **yes**        | **yes, not restricted**                           |
| westeurope         | no                | yes            | not checked                                       |
| northeurope        | no                | yes            | not checked                                       |
| germanywestcentral | yes               | yes            | no: provisioning restricted for this subscription |

Italy North (Milan) is the first region in the preference order that the policy allows, and the closest allowed region to Tunisia. In that region:

- Container Apps managed environments are available.
- PostgreSQL Flexible Server offers Burstable `Standard_B1ms` (1 vCore, 2 GB) with 32 GB managed-disk storage, versions 11 to 18, and the offer is not restricted.
- Geo-redundant backup is not available; use locally redundant backup.

### Resource providers

All nine are `Registered`: Microsoft.App, Microsoft.ContainerRegistry, Microsoft.DBforPostgreSQL, Microsoft.KeyVault, Microsoft.Storage, Microsoft.OperationalInsights, Microsoft.Insights, Microsoft.ManagedIdentity, Microsoft.Network.

Terraform must not try to register others: set `resource_provider_registrations = "none"` in the `azurerm` provider.

### Identity for CI/CD: OIDC is possible

| Check                                | Result          |
| ------------------------------------ | --------------- |
| Tenant setting `allowedToCreateApps` | true            |
| Create app registration              | allowed         |
| Create service principal             | allowed         |
| Add GitHub federated credential      | allowed         |
| Assign roles on the subscription     | allowed (Owner) |

Recommendation: GitHub Actions OIDC with an app registration and federated credentials, no client secret. A classic service principal with a secret is also possible but not needed.

The test app registration was deleted and purged from deleted items; none is left.

### Quotas

| Quota in `italynorth`               | Used / limit |
| ----------------------------------- | ------------ |
| Container Apps managed environments | 0 / 1        |
| Container Apps session pools        | 0 / 1        |
| Dedicated GPU                       | 0 / 0        |

Consequences for the design:

- Only **one** Container Apps environment can exist. Staging and production must share it, or only one stage is deployed.
- Per-environment core limits are only visible once the environment exists. Keep `max_replicas` at 1 or 2 per app and use the Consumption profile.
- VM vCPU quota could not be read: `Microsoft.Compute` is not registered, so `az vm list-usage` returns nothing. Container Apps and PostgreSQL Flexible Server do not need it, so it was left unregistered.

### Cost

- Budgets: `az consumption budget list` succeeds (0 budgets) and Microsoft.Consumption and Microsoft.CostManagement are registered. Terraform can plan a subscription budget. Creation itself was not tested, because that would create a resource.
- Spending limit is On: when the credit is used up, resources are disabled instead of billed.
- Remaining credit is not available from the CLI. See it in the Azure portal under **Education > Overview** (search "Education").
- 12-month free services (PostgreSQL Flexible Server B1ms 750 h/month, 32 GB storage, 32 GB backup): eligibility **cannot be confirmed from the CLI**. What is known: the offer is Azure for Students and no PostgreSQL server exists yet. Confirm in the portal under **Subscriptions > Azure for Students > Free services** (or search "Free services") before the first deployment. The free allowance covers one B1ms server; do not create a second.

## Terraform

`terraform init` and `terraform plan` ran in a temporary directory with `azurerm` v4.81.0, `ARM_SUBSCRIPTION_ID` and `ARM_TENANT_ID` exported from `.azure-context`, and only a `data "azurerm_subscription"` block. The plan read the subscription ("Azure for Students") through the Azure CLI login and proposed no infrastructure change.

To load the context in a shell:

```bash
set -a; . ./.azure-context; set +a
```

## Recommended VS Code extensions (not installed)

| Extension                 | Id                                        |
| ------------------------- | ----------------------------------------- |
| WSL                       | `ms-vscode-remote.remote-wsl`             |
| Prisma                    | `Prisma.prisma`                           |
| ESLint                    | `dbaeumer.vscode-eslint`                  |
| Prettier                  | `esbenp.prettier-vscode`                  |
| Tailwind CSS IntelliSense | `bradlc.vscode-tailwindcss`               |
| HashiCorp Terraform       | `hashicorp.terraform`                     |
| Docker                    | `ms-azuretools.vscode-docker`             |
| Azure Container Apps      | `ms-azuretools.vscode-azurecontainerapps` |

Open the project with `code .` from `~/projects/iconbridge-platform`; the WSL extension is needed for that.

## Blockers and known issues

No blocker. Items to handle:

| Issue                                                               | Fix                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Linux user `dev` has no password, so `sudo` fails                   | From PowerShell: `wsl -u root passwd dev`                                                   |
| Only one Container Apps environment allowed                         | Design for a single shared environment                                                      |
| `francecentral` is blocked by policy                                | Use `italynorth` everywhere (`AZURE_LOCATION` in `.azure-context`)                          |
| Free-tier eligibility unconfirmed                                   | Check **Free services** in the portal before creating the database                          |
| Docker Desktop does not start with Windows                          | Start it before using `docker` in Ubuntu, or enable "Start Docker Desktop when you sign in" |
| systemd in Ubuntu reports `degraded` (`systemd-binfmt` unit failed) | None needed: Windows interop and Docker both work                                           |
| Node 20 was requested first but is end-of-life since April 2026     | Node 22 is the default; use `22` in `.nvmrc`, Dockerfiles and CI                            |

## Additions after the repository foundation (2026-10-10)

| Issue                                                                                                                                                                                  | Fix                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows reserves TCP ports 1024-1123 on this workstation (`netsh interface ipv4 show excludedportrange protocol=tcp`), so Docker Desktop cannot publish Mailpit's usual SMTP port 1025 | Mailpit SMTP is published on host port **2525** (`MAILPIT_SMTP_PORT` in the root `.env`, `SMTP_PORT` in `apps/api/.env`). The web UI stays on 8025 |
| npm `latest` for `prisma` points to an 8.0 release candidate                                                                                                                           | Prisma is pinned to 7.10.0                                                                                                                         |
| TypeScript 7 and ESLint 10 are not yet supported by typescript-eslint, the Nest CLI and `eslint-config-next`                                                                           | TypeScript 6.0.x and ESLint 9.x are pinned in the `catalog` of `pnpm-workspace.yaml`                                                               |

## Additions after the public web application (2026-10-11)

| Issue                                                                              | Fix                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright's Chromium needs system libraries (`libnspr4`, `libnss3`, `libasound2`) | Installed on 2026-10-11 with `sudo pnpm --filter @iconbridge/web exec playwright install-deps chromium`. `pnpm test:browser` runs without any extra environment variable. Run the same command again after a Playwright upgrade if Chromium reports a missing library |
| No GPU in WSL: Chromium renders in software                                        | Lighthouse's full-page screenshot step delays the first paint of image-heavy pages by about 2 seconds here; measurements were taken with `--disable-full-page-screenshot`                                                                                             |
