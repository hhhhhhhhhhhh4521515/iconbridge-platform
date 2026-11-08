# PostgreSQL Flexible Server, sized for the free offer of the subscription: one
# Burstable B1ms server, 32 GB, 7 days of locally redundant backups. Never make it
# larger and never add a second server: staging is a second database on this one.
#
# Public access with one firewall rule (Azure services), TLS required, sign-in with
# Microsoft Entra tokens of the apps' managed identity (ADR-026). VNet integration would
# be safer but needs a VNet-integrated Container Apps environment and a private DNS zone
# (audit H1 part 2; docs/adr/ADR-013-azure-infrastructure.md).

resource "azurerm_postgresql_flexible_server" "this" {
  name                = "psql-iconbridge-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  version             = "16"
  sku_name            = "B_Standard_B1ms"
  storage_mb          = 32768
  storage_tier        = "P4"
  auto_grow_enabled   = false

  backup_retention_days        = 7
  geo_redundant_backup_enabled = false

  administrator_login    = var.administrator_login
  administrator_password = var.administrator_password

  public_network_access_enabled = true

  authentication {
    # Off once the apps run on tokens (ADR-026, step 3).
    password_auth_enabled         = var.password_auth_enabled
    active_directory_auth_enabled = true
    tenant_id                     = var.tenant_id
  }

  tags = var.tags

  lifecycle {
    # Azure picks the availability zone; changing it would mean a new server.
    ignore_changes = [zone]
    # Holds the data of the site: deleting it takes a deliberate edit of this file.
    prevent_destroy = true
  }
}

# The extensions the migrations create (job search: pg_trgm).
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "PG_TRGM"
}

# TLS on every connection (already the default; written down so it cannot drift).
resource "azurerm_postgresql_flexible_server_configuration" "require_tls" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "on"
}

resource "azurerm_postgresql_flexible_server_configuration" "tls_version" {
  name      = "ssl_min_protocol_version"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "TLSv1.2"
}

# Logs every connection, for the audit of who reached the database.
resource "azurerm_postgresql_flexible_server_configuration" "log_connections" {
  name      = "log_connections"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "on"
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  for_each = toset(var.databases)

  name      = each.value
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"

  lifecycle {
    # A database holds the data of the site: Terraform never drops it by mistake.
    prevent_destroy = true
  }
}

# 0.0.0.0 is Azure's convention for "services hosted in Azure": the Container Apps of the
# Consumption plan have no fixed outbound address that a narrower rule could name.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "admin" {
  for_each = toset(var.admin_ip_addresses)

  name             = "admin-${replace(each.value, ".", "-")}"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = each.value
  end_ip_address   = each.value
}

# The apps' managed identity is the Entra administrator: the API, the tasks, migration and
# backup jobs sign in with its tokens (DATABASE_AUTH=entra), as the password user did.
resource "azurerm_postgresql_flexible_server_active_directory_administrator" "apps" {
  server_name         = azurerm_postgresql_flexible_server.this.name
  resource_group_name = var.resource_group_name
  tenant_id           = var.tenant_id
  object_id           = var.entra_admin.object_id
  principal_name      = var.entra_admin.principal_name
  principal_type      = "ServicePrincipal"
}
