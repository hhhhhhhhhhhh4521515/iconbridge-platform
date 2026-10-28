output "endpoint" {
  description = "AZURE_COMMUNICATION_ENDPOINT of the API."
  value       = "https://${azurerm_communication_service.this.hostname}"
}

output "sender_address" {
  description = "MAIL_FROM of the API: the sender on the custom domain once it is in use, else on the Azure-managed domain."
  value = (
    var.use_custom_domain
    ? "${azurerm_email_communication_service_domain_sender_username.custom[0].name}@${azurerm_email_communication_service_domain.custom[0].from_sender_domain}"
    : "${var.sender_username}@${azurerm_email_communication_service_domain.azure_managed.from_sender_domain}"
  )
}

output "dns_records" {
  description = "DNS records that verify the custom domain and authenticate its emails (ownership TXT, SPF TXT, two DKIM CNAMEs). Empty without a custom domain."
  value = flatten([
    for records in try(azurerm_email_communication_service_domain.custom[0].verification_records, []) : [
      for kind in ["domain", "spf", "dkim", "dkim2"] : [
        for record in records[kind] : {
          purpose = "email ${kind == "domain" ? "ownership" : upper(kind)}"
          type    = record.type
          name    = record.name
          value   = record.value
        }
      ]
    ]
  ])
}

output "custom_domain_name" {
  description = "Name of the custom domain resource, for az commands (verification)."
  value       = one(azurerm_email_communication_service_domain.custom[*].name)
}

output "email_service_name" {
  description = "Name of the Email Communication Service, for az commands."
  value       = azurerm_email_communication_service.this.name
}

output "domain_name" {
  description = "Name of the Azure-managed domain resource, for az commands."
  value       = azurerm_email_communication_service_domain.azure_managed.name
}
