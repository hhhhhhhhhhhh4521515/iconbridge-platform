# Files of the application.
#
# - candidate-documents: private. The API uploads with its managed identity and gives
#   5-minute download links signed by user-delegation SAS (no account key exists, so
#   shared key access is off).
# - public-media: job covers, slides and story photos, readable blob by blob without a
#   link (container access "blob"). The account allows public containers only because of
#   this one; every other container stays private.
# - backups: private. Weekly pg_dump files of the backup job, deleted after 30 days by the
#   lifecycle policy below (ADR-020).

resource "azurerm_storage_account" "this" {
  # Lower-case letters and digits only, globally unique, 24 characters at most.
  name                     = "sticonbridge${replace(var.name_suffix, "-", "")}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_kind             = "StorageV2"
  account_tier             = "Standard"
  account_replication_type = "LRS"
  access_tier              = "Hot"

  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = true
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true

  blob_properties {
    delete_retention_policy {
      days = 7
    }

    container_delete_retention_policy {
      days = 7
    }

    # Pictures are shown by <img> tags, which need no CORS; this rule covers a script of
    # the site that reads a public file.
    dynamic "cors_rule" {
      for_each = length(var.cors_allowed_origins) > 0 ? [1] : []
      content {
        allowed_origins    = var.cors_allowed_origins
        allowed_methods    = ["GET", "HEAD"]
        allowed_headers    = ["*"]
        exposed_headers    = ["Content-Length", "Content-Type", "ETag"]
        max_age_in_seconds = 3600
      }
    }
  }

  tags = var.tags

  lifecycle {
    # Holds data: deleting it takes a deliberate edit of this file.
    prevent_destroy = true
  }
}

# The person or pipeline running Terraform creates the containers through Entra ID.
resource "azurerm_role_assignment" "deployer" {
  scope                = azurerm_storage_account.this.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.deployer_principal_id
}

resource "azurerm_role_assignment" "apps_data" {
  scope                = azurerm_storage_account.this.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.apps_principal_id
}

# Needed to ask for the user-delegation key that signs the download links.
resource "azurerm_role_assignment" "apps_delegator" {
  scope                = azurerm_storage_account.this.id
  role_definition_name = "Storage Blob Delegator"
  principal_id         = var.apps_principal_id
}

# Role assignments take a moment to reach the storage service.
resource "time_sleep" "rbac" {
  create_duration = "60s"
  depends_on      = [azurerm_role_assignment.deployer]
}

resource "azurerm_storage_container" "documents" {
  name                  = "candidate-documents"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
  depends_on            = [time_sleep.rbac]

  lifecycle {
    # Holds data: deleting it takes a deliberate edit of this file.
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "public_media" {
  name                  = "public-media"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "blob"
  depends_on            = [time_sleep.rbac]

  lifecycle {
    # Holds data: deleting it takes a deliberate edit of this file.
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "backups" {
  name                  = "backups"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
  depends_on            = [time_sleep.rbac]

  lifecycle {
    # Holds data: deleting it takes a deliberate edit of this file.
    prevent_destroy = true
  }
}

# Backups older than 30 days are deleted (then kept 7 more days by the blob soft delete).
# The policy covers the backups container only: candidate files follow the retention task
# of the API, public media their own life.
resource "azurerm_storage_management_policy" "this" {
  storage_account_id = azurerm_storage_account.this.id

  rule {
    name    = "delete-backups-after-${var.backup_retention_days}-days"
    enabled = true

    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["${azurerm_storage_container.backups.name}/"]
    }

    actions {
      base_blob {
        delete_after_days_since_creation_greater_than = var.backup_retention_days
      }
    }
  }
}

# Who read, wrote or deleted which file (candidate documents included), in Log Analytics.
# Counts against the daily ingestion cap of the workspace.
resource "azurerm_monitor_diagnostic_setting" "blobs" {
  name                       = "blob-access-to-log-analytics"
  target_resource_id         = "${azurerm_storage_account.this.id}/blobServices/default"
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "StorageRead"
  }

  enabled_log {
    category = "StorageWrite"
  }

  enabled_log {
    category = "StorageDelete"
  }
}
