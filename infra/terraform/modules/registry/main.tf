# Where the images come from. Two choices (variable registry_type):
#
# - "acr": Azure Container Registry, Standard tier. Admin user disabled; the apps pull
#   with their managed identity (AcrPull). One Standard registry is part of the
#   12 months of free services of the subscription.
# - "ghcr": GitHub Container Registry, free. The apps pull with a GitHub token kept in
#   Key Vault (secret `ghcr-pull-token`); nothing is created here.

resource "azurerm_container_registry" "this" {
  count = var.registry_type == "acr" ? 1 : 0

  # Alphanumeric only, globally unique.
  name                = "acriconbridge${replace(var.name_suffix, "-", "")}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"
  admin_enabled       = false
  # Standard has no private endpoint; pulls and pushes need Entra ID tokens.
  public_network_access_enabled = true
  anonymous_pull_enabled        = false
  tags                          = var.tags
}

resource "azurerm_role_assignment" "pull" {
  count = var.registry_type == "acr" ? 1 : 0

  scope                = azurerm_container_registry.this[0].id
  role_definition_name = "AcrPull"
  principal_id         = var.pull_principal_id
}
