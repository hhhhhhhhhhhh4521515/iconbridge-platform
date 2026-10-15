# One user-assigned identity for the API, the web app and the jobs. It exists before the
# apps, so its roles are in place when the first revision starts. The role assignments
# live with the resources they open (registry, vault, storage).
resource "azurerm_user_assigned_identity" "apps" {
  name                = "id-iconbridge-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}
