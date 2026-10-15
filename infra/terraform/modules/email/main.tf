# Outgoing email: Azure Communication Services Email with an Azure-managed domain
# (<guid>.azurecomm.net, no DNS to manage). The API sends with the managed identity:
# no SMTP server, no password, no connection string.
#
# Limits of an Azure-managed domain, per subscription, that cannot be raised: 5 emails a
# minute and 10 an hour. The outbox of the API waits when Azure answers 429. A verified
# custom domain lifts them (docs/adr/ADR-014-email-azure-communication-services.md).
#
# Communication Services are global resources; their data (emails being sent, logs) stays
# in the data location, Europe.

resource "azurerm_email_communication_service" "this" {
  name                = "ecs-iconbridge-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  data_location       = var.data_location
  tags                = var.tags
}

# The sender address DoNotReply@<domain> comes with the domain. Its display name is set
# once with `az` (docs/DEPLOYMENT.md): Azure creates that sender itself, and the provider
# cannot take over a sender that already exists during the apply that creates it.
resource "azurerm_email_communication_service_domain" "azure_managed" {
  name              = "AzureManagedDomain"
  email_service_id  = azurerm_email_communication_service.this.id
  domain_management = "AzureManaged"
  # No tracking pixel or rewritten links in emails about candidates.
  user_engagement_tracking_enabled = false
  tags                             = var.tags
}

resource "azurerm_communication_service" "this" {
  name                = "acs-iconbridge-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  data_location       = var.data_location
  tags                = var.tags
}

resource "azurerm_communication_service_email_domain_association" "this" {
  communication_service_id = azurerm_communication_service.this.id
  email_service_domain_id  = azurerm_email_communication_service_domain.azure_managed.id
}

# Sending with Entra ID needs a role on the Communication Service. The only built-in role
# that allows it is this one; custom roles are not reliably honoured by the email service.
# Scoped to this Communication Service only, not to the resource group.
resource "azurerm_role_assignment" "apps_send" {
  scope                = azurerm_communication_service.this.id
  role_definition_name = "Communication and Email Service Owner"
  principal_id         = var.apps_principal_id
}
