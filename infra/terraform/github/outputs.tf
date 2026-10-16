output "client_ids" {
  description = "Client id of each identity, for the GitHub secrets (docs/CICD.md): AZURE_CLIENT_ID_PLAN, AZURE_CLIENT_ID_PUSH, and AZURE_CLIENT_ID of the production environment."
  value       = { for key, app in azuread_application.github : key => app.client_id }
}

output "deploy_object_id" {
  description = "Object id of the deploy identity."
  value       = azuread_service_principal.github["deploy"].object_id
}
