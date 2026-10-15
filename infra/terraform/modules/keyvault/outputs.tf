output "id" {
  description = "Id of the Key Vault."
  value       = azurerm_key_vault.this.id
}

output "name" {
  description = "Name of the Key Vault."
  value       = azurerm_key_vault.this.name
}

output "uri" {
  description = "URI of the Key Vault."
  value       = azurerm_key_vault.this.vault_uri
}

output "secret_ids" {
  description = "Secret name => versionless id, for Container Apps references (they then follow new versions)."
  value = merge(
    { for name, secret in azurerm_key_vault_secret.generated : name => secret.versionless_id },
    { for name, secret in azurerm_key_vault_secret.external : name => secret.versionless_id },
  )
}
