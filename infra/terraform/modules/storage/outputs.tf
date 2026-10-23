output "account_name" {
  description = "Name of the storage account."
  value       = azurerm_storage_account.this.name
}

output "account_id" {
  description = "Id of the storage account."
  value       = azurerm_storage_account.this.id
}

output "blob_endpoint" {
  description = "AZURE_STORAGE_ACCOUNT_URL of the API, without the trailing slash."
  value       = trimsuffix(azurerm_storage_account.this.primary_blob_endpoint, "/")
}

output "public_media_base_url" {
  description = "PUBLIC_MEDIA_BASE_URL of the API."
  value       = "${trimsuffix(azurerm_storage_account.this.primary_blob_endpoint, "/")}/${azurerm_storage_container.public_media.name}"
}

output "backups_container_url" {
  description = "Address of the private backups container (BACKUP_CONTAINER_URL of the backup job)."
  value       = "${trimsuffix(azurerm_storage_account.this.primary_blob_endpoint, "/")}/${azurerm_storage_container.backups.name}"
}
