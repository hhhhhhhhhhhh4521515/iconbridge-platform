# ADR-015: Container Apps environment created with an explicit mode

Date: 2026-10-15. Status: accepted. Amends [ADR-013](ADR-013-azure-infrastructure.md), point 8.

## Context

The first `terraform apply` of production created the Container Apps environment with `azurerm_container_app_environment` (azurerm 4.81). Azure made it an **Express** environment (`environmentMode: Express`), a mode that became generally available in October 2026. Express refuses two things this design depends on:

- Key Vault references in app secrets (`ExpressEnvironmentFeatureNotSupported: 'KeyVaultUrl in secrets'`): the apps read every secret from Key Vault through the managed identity (ADR-013, point 5).
- Container Apps Jobs (`ExpressEnvironmentResourceNotSupported`): the migration job and the scheduled tasks job (ADR-006, ADR-012).

Microsoft's FAQ says a template that creates an environment gets a standard one unless it sets `EnvironmentMode = Express`. That is not what happened here: the azurerm provider calls an API version without the property, and Azure chose Express. The mode cannot be changed in place, and the subscription allows one environment per region.

## Decision

1. The environment is created with the **azapi** provider (`Azure/azapi ~> 2.12`), `Microsoft.App/managedEnvironments@2026-07-01`, with `environmentMode = "ConsumptionOnly"`: the serverless Consumption environment ADR-013 assumed, with no workload profile and no management fee. azurerm stays for everything else, including the Container Apps and Jobs, which accept the environment's id.
2. A `postcondition` fails the apply if Azure returns any other mode, so the problem can never come back silently.
3. azapi's built-in schemas stop at API 2026-01-01, which has no `environmentMode`; schema validation is off for this resource only. Azure validates the request itself.
4. The Log Analytics shared key goes in `sensitive_body`, so it never shows in a plan.
5. The empty Express environment is removed from the state and deleted, then the new one is created under the same name. No app or job had been created in it.

Rejected: adapting to Express. Secrets would have to be copied into each app's configuration (readable by anyone who can read the app) instead of referenced in Key Vault, migrations would run at API start-up (several replicas racing, and a failed migration taking the API down), and the scheduled tasks would have no runner while the API is scaled to zero.

## Consequences

- One more provider to keep up to date. When azurerm supports the mode, the environment can move back with a `moved`/import step.
- The environment gets a new default domain (the web app's address changes from the one of the deleted environment); nothing had been published at the old one.
- Microsoft may select existing environments for automatic migration to Express, with a notice 25 to 30 days ahead. Environments with Jobs are not eligible. If a notice arrives anyway, submit the opt-out form it contains.
