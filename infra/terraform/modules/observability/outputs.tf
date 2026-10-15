output "log_analytics_workspace_id" {
  description = "Id of the Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.this.id
}

output "application_insights_connection_string" {
  description = "Connection string of Application Insights (kept in Key Vault)."
  value       = azurerm_application_insights.this.connection_string
  sensitive   = true
}
