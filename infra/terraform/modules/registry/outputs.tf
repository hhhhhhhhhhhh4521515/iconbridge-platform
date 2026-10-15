output "login_server" {
  description = "Prefix of the image names, e.g. acriconbridgeproditn.azurecr.io or ghcr.io/<owner>."
  value       = var.registry_type == "acr" ? azurerm_container_registry.this[0].login_server : "ghcr.io/${lower(var.ghcr_owner)}"
}

output "server" {
  description = "Registry host the Container Apps authenticate against."
  value       = var.registry_type == "acr" ? azurerm_container_registry.this[0].login_server : "ghcr.io"
}

output "id" {
  description = "Id of the Azure Container Registry (null with ghcr)."
  value       = var.registry_type == "acr" ? azurerm_container_registry.this[0].id : null
}
