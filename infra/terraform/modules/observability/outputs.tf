output "log_analytics_workspace_id" {
  description = "Id of the Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.this.id
}

output "application_insights_connection_string" {
  description = "Connection string of Application Insights (kept in Key Vault)."
  value       = azurerm_application_insights.this.connection_string
  sensitive   = true
}

output "log_analytics_customer_id" {
  description = "Workspace (customer) id, for the Container Apps environment's logs."
  value       = azurerm_log_analytics_workspace.this.workspace_id
}

output "log_analytics_shared_key" {
  description = "Primary shared key of the workspace, for the Container Apps environment's logs."
  value       = azurerm_log_analytics_workspace.this.primary_shared_key
  sensitive   = true
}

output "application_insights_id" {
  description = "Id of Application Insights (alerts, availability tests, workbook)."
  value       = azurerm_application_insights.this.id
}
