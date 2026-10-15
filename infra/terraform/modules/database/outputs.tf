output "fqdn" {
  description = "Host name of the PostgreSQL server."
  value       = azurerm_postgresql_flexible_server.this.fqdn
}

output "server_id" {
  description = "Id of the PostgreSQL server."
  value       = azurerm_postgresql_flexible_server.this.id
}

output "administrator_login" {
  description = "Administrator login of the PostgreSQL server."
  value       = azurerm_postgresql_flexible_server.this.administrator_login
}
