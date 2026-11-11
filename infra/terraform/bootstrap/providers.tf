# Resource providers that envs/prod needs beyond the nine the subscription came with
# (docs/00-environment.md). Registering is a subscription-level action and the CI identities
# only have rights on the resource group, so it is done here, applied by the owner.
locals {
  resource_providers = toset(["Microsoft.Communication", "Microsoft.EventGrid"])
}

resource "azurerm_resource_provider_registration" "this" {
  for_each = local.resource_providers
  name     = each.value
}

# Registered by hand before the first apply (ADR-014).
import {
  to = azurerm_resource_provider_registration.this["Microsoft.Communication"]
  id = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Communication"
}
