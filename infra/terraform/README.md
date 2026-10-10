# Terraform

Empty for now. The Azure infrastructure is added in a later step.

Constraints to respect, from [docs/00-environment.md](../../docs/00-environment.md) and [docs/SPEC.md](../../docs/SPEC.md):

- Region `italynorth` only.
- `resource_provider_registrations = "none"` in the `azurerm` provider.
- One Container Apps environment (quota 1), Consumption profile, min replicas 0, max 2.
- One PostgreSQL Flexible Server, `Standard_B1ms`, 32 GB, locally redundant backup. Never a second server.
- PostgreSQL server parameter `azure.extensions` must include `PG_TRGM` (a migration creates the `pg_trgm` extension).
- Storage: a `public-media` container readable anonymously blob by blob (job covers), and a private `candidate-documents` container.
- The API reaches storage with its managed identity: set `AZURE_STORAGE_ACCOUNT_URL` (not a connection string) and grant the identity `Storage Blob Data Contributor` and `Storage Blob Delegator` on the storage account.
- The web app and the API must be on the same site (custom domain or proxy) for the session cookies, see ADR-003.
- Scheduled tasks: a Container Apps Job (cron `*/15 * * * *`) in the same environment, running the API image with the command `node dist/cli.js all`, the same settings and identity as the API. Set `SCHEDULER_ENABLED=false` on the API app (see ADR-006).
- GitHub Actions authenticates with OIDC (app registration + federated credential), no client secret.
- `terraform apply` and `terraform destroy` are run only after explicit approval.
