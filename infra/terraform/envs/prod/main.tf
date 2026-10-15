# Production of IconBridge Jobs. See docs/DEPLOYMENT.md for the runbook and
# docs/adr/ADR-013-azure-infrastructure.md for the choices.

data "azurerm_client_config" "current" {}

locals {
  env = "prod"

  region_short = {
    italynorth         = "itn"
    germanywestcentral = "gwc"
    spaincentral       = "spc"
    austriaeast        = "ate"
    centralindia       = "inc"
  }[var.location]

  # <type>-iconbridge-<env>-<region-short>
  name_suffix = "${local.env}-${local.region_short}"

  tags = {
    project    = "iconbridge"
    env        = local.env
    owner      = var.owner_email
    managed-by = "terraform"
  }

  # The default address of an external Container App: <app name>.<environment domain>.
  web_app_name = "ca-iconbridge-web-${local.name_suffix}"
  web_origin = (
    var.enable_custom_domain
    ? "https://${var.custom_domain}"
    : "https://${local.web_app_name}.${azurerm_container_app_environment.this.default_domain}"
  )
}

resource "azurerm_resource_group" "this" {
  name     = "rg-iconbridge-${local.env}"
  location = var.location
  tags     = local.tags
}

# ---------------------------------------------------------------------------
# Secrets made here, kept in Key Vault only (and in the state, which is private).

resource "random_password" "db_admin" {
  length      = 32
  special     = false
  min_upper   = 2
  min_lower   = 2
  min_numeric = 2
}

resource "random_password" "jwt_access" {
  length  = 64
  special = false
}

resource "random_password" "revalidate" {
  length  = 48
  special = false
}

# PASSPORT_ENCRYPTION_KEY: AES-256, 32 random bytes, base64. Losing it makes every
# stored passport number unreadable: the vault keeps old versions and has purge protection.
resource "random_bytes" "passport_key" {
  length = 32
}

# First super admin of the site. Change the password at the first sign-in.
resource "random_password" "seed_admin" {
  length           = 24
  special          = true
  override_special = "-_.!"
  min_special      = 2
}

module "identity" {
  source              = "../../modules/identity"
  name_suffix         = local.name_suffix
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

module "observability" {
  source              = "../../modules/observability"
  name_suffix         = local.name_suffix
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

module "registry" {
  source              = "../../modules/registry"
  registry_type       = var.registry_type
  name_suffix         = local.name_suffix
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
  pull_principal_id   = module.identity.principal_id
  ghcr_owner          = var.ghcr_owner
}

module "database" {
  source                 = "../../modules/database"
  name_suffix            = local.name_suffix
  location               = var.location
  resource_group_name    = azurerm_resource_group.this.name
  tags                   = local.tags
  administrator_password = random_password.db_admin.result
  databases              = ["iconbridge"]
  admin_ip_addresses     = var.admin_ip_addresses
}

module "storage" {
  source                = "../../modules/storage"
  name_suffix           = local.name_suffix
  location              = var.location
  resource_group_name   = azurerm_resource_group.this.name
  tags                  = local.tags
  apps_principal_id     = module.identity.principal_id
  deployer_principal_id = data.azurerm_client_config.current.object_id
  cors_allowed_origins  = [local.web_origin]

  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
}

module "email" {
  source              = "../../modules/email"
  name_suffix         = local.name_suffix
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
  apps_principal_id   = module.identity.principal_id
}

module "keyvault" {
  source                = "../../modules/keyvault"
  name_suffix           = local.name_suffix
  location              = var.location
  resource_group_name   = azurerm_resource_group.this.name
  tags                  = local.tags
  tenant_id             = data.azurerm_client_config.current.tenant_id
  deployer_principal_id = data.azurerm_client_config.current.object_id
  apps_principal_id     = module.identity.principal_id

  generated_secrets = {
    "db-admin-password" = random_password.db_admin.result
    "database-url" = format(
      "postgresql://%s:%s@%s:5432/iconbridge?sslmode=require&schema=public",
      module.database.administrator_login,
      urlencode(random_password.db_admin.result),
      module.database.fqdn,
    )
    "jwt-access-secret"       = random_password.jwt_access.result
    "passport-encryption-key" = random_bytes.passport_key.base64
    "revalidate-secret"       = random_password.revalidate.result
    "seed-admin-email"        = var.owner_email
    "seed-admin-password"     = random_password.seed_admin.result
    "appinsights-connection"  = module.observability.application_insights_connection_string
  }

  # Set by hand after the first apply (docs/DEPLOYMENT.md, "External secrets"). Email needs
  # none: the API sends through Azure Communication Services with its managed identity.
  external_secrets = concat(
    ["turnstile-site-key", "turnstile-secret-key"],
    var.registry_type == "ghcr" ? ["ghcr-pull-token"] : [],
  )
}

# The only Container Apps environment the subscription allows in the region. A staging
# environment of this repository reads it (data source) instead of creating its own.
resource "azurerm_container_app_environment" "this" {
  name                       = "cae-iconbridge-${local.name_suffix}"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.this.name
  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
  logs_destination           = "log-analytics"
  tags                       = local.tags
}

module "container_apps" {
  source              = "../../modules/container_apps"
  name_suffix         = local.name_suffix
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
  environment_id      = azurerm_container_app_environment.this.id
  identity_id         = module.identity.id
  registry_type       = var.registry_type
  registry_server     = module.registry.server
  registry_username   = var.ghcr_username
  secret_ids          = module.keyvault.secret_ids
  custom_domain       = var.enable_custom_domain ? var.custom_domain : ""
  api                 = var.api_size
  web                 = var.web_size

  api_env = {
    NODE_ENV   = "production"
    PORT       = "4000"
    WEB_ORIGIN = local.web_origin
    # Empty: the API tells the web app about changes through WEB_ORIGIN.
    WEB_INTERNAL_URL                = ""
    AZURE_STORAGE_ACCOUNT_URL       = module.storage.blob_endpoint
    AZURE_STORAGE_CONNECTION_STRING = ""
    PUBLIC_MEDIA_BASE_URL           = module.storage.public_media_base_url
    # The Azure SDK picks the user-assigned identity with this id.
    AZURE_CLIENT_ID = module.identity.client_id
    # Azure Communication Services Email, with the managed identity (AZURE_CLIENT_ID).
    EMAIL_TRANSPORT              = "azure"
    AZURE_COMMUNICATION_ENDPOINT = module.email.endpoint
    MAIL_FROM                    = module.email.sender_address
    MAIL_DELIVERY                = "background"
    TRUST_PROXY_HOPS             = tostring(var.trust_proxy_hops)
    SCHEDULER_ENABLED            = "false"
  }

  api_secret_env = {
    DATABASE_URL                          = "database-url"
    JWT_ACCESS_SECRET                     = "jwt-access-secret"
    PASSPORT_ENCRYPTION_KEY               = "passport-encryption-key"
    REVALIDATE_SECRET                     = "revalidate-secret"
    TURNSTILE_SECRET_KEY                  = "turnstile-secret-key"
    APPLICATIONINSIGHTS_CONNECTION_STRING = "appinsights-connection"
  }

  web_env = {
    API_INTERNAL_URL  = "http://ca-iconbridge-api-${local.name_suffix}"
    CSP_MEDIA_ORIGINS = trimsuffix(module.storage.blob_endpoint, "/")
  }

  web_secret_env = {
    REVALIDATE_SECRET                     = "revalidate-secret"
    APPLICATIONINSIGHTS_CONNECTION_STRING = "appinsights-connection"
  }

  migrate_secret_env = {
    DATABASE_URL            = "database-url"
    PASSPORT_ENCRYPTION_KEY = "passport-encryption-key"
    SEED_ADMIN_EMAIL        = "seed-admin-email"
    SEED_ADMIN_PASSWORD     = "seed-admin-password"
  }

  # The Container Apps read Key Vault, pull images and send emails with the identity: its
  # roles must exist first.
  depends_on = [module.keyvault, module.registry, module.email]
}

# ---------------------------------------------------------------------------
# Budget: emails at 50, 80 and 100 % of the month's amount. The spending limit of the
# subscription stops resources at the end of the credit; this warns long before.

resource "azurerm_consumption_budget_resource_group" "this" {
  count = var.enable_budget ? 1 : 0

  name              = "budget-iconbridge-${local.name_suffix}"
  resource_group_id = azurerm_resource_group.this.id
  amount            = var.budget_amount
  time_grain        = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThanOrEqualTo"
      threshold_type = "Actual"
      contact_emails = [var.owner_email]
    }
  }

  lifecycle {
    # Azure moves the start date as months pass.
    ignore_changes = [time_period]
  }
}
