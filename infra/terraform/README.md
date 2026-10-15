# Terraform

Azure infrastructure of IconBridge Jobs. Runbook: [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md). Choices: [ADR-013](../../docs/adr/ADR-013-azure-infrastructure.md).

| Folder          | Content                                                                                               | State                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `bootstrap/`    | Resource group `rg-iconbridge-tfstate`, storage account and container `tfstate` for the remote state  | Local (`bootstrap/terraform.tfstate`) |
| `modules/`      | `observability`, `registry`, `identity`, `keyvault`, `database`, `storage`, `email`, `container_apps` | —                                     |
| `envs/prod/`    | Production: composes the modules, creates the shared Container Apps environment, the budget           | `tfstate/prod.tfstate`                |
| `envs/staging/` | Not deployed. How a staging environment would reuse the shared server and environment                 | —                                     |

Commands, from the repository root (they load `.azure-context` and use the `az login` session):

```bash
make tf-check                 # fmt, validate, tflint, checkov
make tf-bootstrap             # once
make tf-init ENV=prod
make tf-plan ENV=prod         # writes envs/prod/tfplan
make tf-apply ENV=prod        # applies that plan, after review
make tf-destroy ENV=prod      # asks for the environment's name
```

Rules:

- Region from `docs/00-environment.md` (`italynorth`); `resource_provider_registrations = "none"`.
- Names: `<type>-iconbridge-<env>-<region-short>` (`itn` for Italy North); tags `project`, `env`, `owner`, `managed-by=terraform`.
- One Container Apps environment and one PostgreSQL server for the whole subscription. Never a second server, never a larger SKU.
- No secret in a `.tf` or `.tfvars` file: secrets are generated into Key Vault, or set there by hand.
- `terraform apply` and `destroy` only after the owner's explicit approval.
