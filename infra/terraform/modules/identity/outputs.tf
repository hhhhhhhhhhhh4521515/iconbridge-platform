output "id" {
  description = "Id of the managed identity."
  value       = azurerm_user_assigned_identity.apps.id
}

output "principal_id" {
  description = "Object id of the managed identity, for role assignments."
  value       = azurerm_user_assigned_identity.apps.principal_id
}

output "client_id" {
  description = "Given to the apps as AZURE_CLIENT_ID, so the Azure SDK picks this identity."
  value       = azurerm_user_assigned_identity.apps.client_id
}
