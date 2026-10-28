output "resource_group_name" {
  description = "Resource group of production."
  value       = azurerm_resource_group.this.name
}

output "web_url" {
  description = "Public address of the site."
  value       = local.web_origin
}

output "web_default_fqdn" {
  description = "Default Azure host name of the web app; NEXT_PUBLIC_SITE_URL of the web image is https:// + this when there is no custom domain."
  value       = module.container_apps.web_fqdn
}

output "api_internal_fqdn" {
  description = "Internal host name of the API (inside the environment only)."
  value       = module.container_apps.api_internal_fqdn
}

output "container_app_names" {
  description = "Names of the apps and jobs, for az containerapp commands."
  value = {
    api     = module.container_apps.api_name
    web     = module.container_apps.web_name
    migrate = module.container_apps.migrate_job_name
    tasks   = module.container_apps.tasks_job_name
  }
}

output "registry_login_server" {
  description = "Prefix of the image names to push."
  value       = module.registry.login_server
}

output "key_vault_name" {
  description = "Name of the Key Vault, for az keyvault secret set."
  value       = module.keyvault.name
}

output "storage_account_name" {
  description = "Storage account of the application files."
  value       = module.storage.account_name
}

output "postgres_fqdn" {
  description = "Host name of the PostgreSQL server."
  value       = module.database.fqdn
}

output "identity_client_id" {
  description = "Client id of the managed identity of the apps (AZURE_CLIENT_ID)."
  value       = module.identity.client_id
}

output "custom_domain_verification_id" {
  description = "Value of the TXT record asuid.<domain> for a custom domain."
  value       = azapi_resource.container_app_environment.output.properties.customDomainConfiguration.customDomainVerificationId
  sensitive   = true
}

output "managed_certificate_names" {
  description = "With a custom domain: host name => its managed certificate, to bind once (docs/DEPLOYMENT.md, \"Custom domain\")."
  value       = module.container_apps.managed_certificate_names
}

output "dns_records" {
  description = "Records to create at the DNS provider (DNS only, not proxied) for custom_domain, its aliases and email_domain. Available as soon as the names are set, before enable_custom_domain and use_email_domain."
  value = concat(
    var.custom_domain == "" ? [] : [
      {
        purpose = "site address"
        type    = "A"
        name    = var.custom_domain
        value   = data.azurerm_container_app_environment.this.static_ip_address
      },
      {
        purpose = "site ownership"
        type    = "TXT"
        name    = "asuid.${var.custom_domain}"
        value   = nonsensitive(azapi_resource.container_app_environment.output.properties.customDomainConfiguration.customDomainVerificationId)
      },
    ],
    flatten([
      for alias in var.custom_domain_aliases : [
        {
          purpose = "site alias"
          type    = "CNAME"
          name    = alias
          value   = module.container_apps.web_fqdn
        },
        {
          purpose = "site alias ownership"
          type    = "TXT"
          name    = "asuid.${alias}"
          value   = nonsensitive(azapi_resource.container_app_environment.output.properties.customDomainConfiguration.customDomainVerificationId)
        },
      ]
    ]),
    module.email.dns_records,
  )
}

output "mail_sender" {
  description = "Sender of the emails (MAIL_FROM of the API)."
  value       = module.email.sender_address
}

output "communication_endpoint" {
  description = "Endpoint of Azure Communication Services (AZURE_COMMUNICATION_ENDPOINT of the API)."
  value       = module.email.endpoint
}

output "mail_display_name_command" {
  description = "Run once after the first apply: gives the sender its display name (Terraform cannot, see modules/email)."
  value = join(" ", [
    "az communication email domain sender-username update",
    "--resource-group ${azurerm_resource_group.this.name}",
    "--email-service-name ${module.email.email_service_name}",
    "--domain-name ${module.email.domain_name}",
    "--sender-username DoNotReply",
    "--display-name '${var.mail_display_name}'",
  ])
}
