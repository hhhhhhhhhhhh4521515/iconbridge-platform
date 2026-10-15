# Staging (not deployed)

The subscription allows one Container Apps environment and the free offer covers one
PostgreSQL server. A staging environment therefore does not copy `envs/prod`; it reuses:

| Shared from production                               | How staging uses it                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Container Apps environment `cae-iconbridge-prod-itn` | `data "azurerm_container_app_environment"`, passed as `environment_id`       |
| PostgreSQL server `psql-iconbridge-prod-itn`         | A second database, `iconbridge_staging`, added to `databases` in `envs/prod` |
| Log Analytics workspace                              | The same workspace (logs of the shared environment)                          |

and creates its own, with the `staging` suffix: resource group `rg-iconbridge-staging`,
identity, Key Vault, storage account, and the `container_apps` module (apps named
`ca-iconbridge-*-staging-itn`). Steps:

1. Add `iconbridge_staging` to `databases` in `envs/prod/main.tf` and apply production.
2. Copy `envs/prod/versions.tf` here with `key = "staging.tfstate"`.
3. Write `main.tf` with the modules above and data sources for the shared resources.
4. Build a web image with the staging address as `NEXT_PUBLIC_SITE_URL`.
