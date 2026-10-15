output "endpoint" {
  description = "AZURE_COMMUNICATION_ENDPOINT of the API."
  value       = "https://${azurerm_communication_service.this.hostname}"
}

output "sender_address" {
  description = "MAIL_FROM of the API: the sender on the Azure-managed domain."
  value       = "${var.sender_username}@${azurerm_email_communication_service_domain.azure_managed.from_sender_domain}"
}

output "email_service_name" {
  description = "Name of the Email Communication Service, for az commands."
  value       = azurerm_email_communication_service.this.name
}

output "domain_name" {
  description = "Name of the Azure-managed domain resource, for az commands."
  value       = azurerm_email_communication_service_domain.azure_managed.name
}
