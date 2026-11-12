output "web_fqdn" {
  description = "Default public host name of the web app."
  value       = azurerm_container_app.web.ingress[0].fqdn
}

output "api_internal_fqdn" {
  description = "Internal host name of the API, reachable inside the environment only."
  value       = azurerm_container_app.api.ingress[0].fqdn
}

output "api_name" {
  description = "Name of the API Container App."
  value       = azurerm_container_app.api.name
}

output "web_name" {
  description = "Name of the web Container App."
  value       = azurerm_container_app.web.name
}

output "migrate_job_name" {
  description = "Name of the migration job."
  value       = azurerm_container_app_job.migrate.name
}

output "tasks_job_name" {
  description = "Name of the scheduled tasks job."
  value       = azurerm_container_app_job.tasks.name
}

output "managed_certificate_names" {
  description = "Custom host name => name of its managed certificate, for `az containerapp hostname bind`."
  value       = { for name, certificate in azurerm_container_app_environment_managed_certificate.web : name => certificate.name }
}

output "api_id" {
  description = "Id of the API Container App (metrics, alerts)."
  value       = azurerm_container_app.api.id
}

output "web_id" {
  description = "Id of the web Container App (metrics, alerts)."
  value       = azurerm_container_app.web.id
}

output "tasks_job_id" {
  description = "Resource id of the scheduled tasks job (its Executions metric)."
  value       = azurerm_container_app_job.tasks.id
}

output "backup_job_id" {
  description = "Resource id of the database backup job (its Executions metric)."
  value       = azurerm_container_app_job.backup.id
}

output "backup_job_name" {
  description = "Name of the database backup job."
  value       = azurerm_container_app_job.backup.name
}
