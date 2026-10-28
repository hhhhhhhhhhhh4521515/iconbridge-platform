# Outgoing email: Azure Communication Services Email. The API sends with the managed
# identity: no SMTP server, no password, no connection string.
#
# Two domains: the Azure-managed one (<guid>.azurecomm.net, no DNS to manage) and,
# optionally, the site's own domain (custom_domain). Limits of the Azure-managed domain,
# per subscription, that cannot be raised: 5 emails a minute and 10 an hour. A verified
# custom domain starts higher and can be raised by a support request (ADR-014, ADR-023).
# The outbox of the API waits when Azure answers 429.
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

# The site's own domain, in three steps (docs/DEPLOYMENT.md, "Email on the site's domain"):
# 1. custom_domain set: Azure creates the domain, unverified, and gives the DNS records
#    (output dns_records: verification TXT, SPF, two DKIM CNAMEs).
# 2. The records added at the DNS provider, verification started with `az` once.
# 3. use_custom_domain = true: the sender noreply@<domain> with its display name, the link
#    to the Communication Service, and MAIL_FROM of the API switch to it. Azure refuses to
#    link a domain that is not verified, so this step waits for step 2.
resource "azurerm_email_communication_service_domain" "custom" {
  count = var.custom_domain == "" ? 0 : 1

  name                             = var.custom_domain
  email_service_id                 = azurerm_email_communication_service.this.id
  domain_management                = "CustomerManaged"
  user_engagement_tracking_enabled = false
  tags                             = var.tags
}

resource "azurerm_email_communication_service_domain_sender_username" "custom" {
  count = var.use_custom_domain ? 1 : 0

  name                    = var.custom_sender_username
  email_service_domain_id = azurerm_email_communication_service_domain.custom[0].id
  display_name            = var.display_name
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

# The Azure-managed domain stays linked: switching back is only a change of MAIL_FROM.
resource "azurerm_communication_service_email_domain_association" "custom" {
  count = var.use_custom_domain ? 1 : 0

  communication_service_id = azurerm_communication_service.this.id
  email_service_domain_id  = azurerm_email_communication_service_domain.custom[0].id
}

# Sending with Entra ID needs a role on the Communication Service. The only built-in role
# that allows it is this one; custom roles are not reliably honoured by the email service.
# Scoped to this Communication Service only, not to the resource group.
resource "azurerm_role_assignment" "apps_send" {
  scope                = azurerm_communication_service.this.id
  role_definition_name = "Communication and Email Service Owner"
  principal_id         = var.apps_principal_id
}
