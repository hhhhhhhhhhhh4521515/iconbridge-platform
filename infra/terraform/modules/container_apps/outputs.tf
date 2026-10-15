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
