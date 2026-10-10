# Terraform

Empty for now. The Azure infrastructure is added in a later step.

Constraints to respect, from [docs/00-environment.md](../../docs/00-environment.md) and [docs/SPEC.md](../../docs/SPEC.md):

- Region `italynorth` only.
- `resource_provider_registrations = "none"` in the `azurerm` provider.
- One Container Apps environment (quota 1), Consumption profile, min replicas 0, max 2.
- One PostgreSQL Flexible Server, `Standard_B1ms`, 32 GB, locally redundant backup. Never a second server.
- GitHub Actions authenticates with OIDC (app registration + federated credential), no client secret.
- `terraform apply` and `terraform destroy` are run only after explicit approval.
