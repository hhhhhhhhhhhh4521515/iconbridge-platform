# Remote state for every environment of IconBridge Jobs: one resource group, one storage
# account, one private container `tfstate`. Run once with `make tf-bootstrap`.

data "azurerm_client_config" "current" {}

locals {
  tags = {
    project    = "iconbridge"
    env        = "shared"
    owner      = var.owner
    managed-by = "terraform"
  }
}

resource "azurerm_resource_group" "tfstate" {
  name     = "rg-iconbridge-tfstate"
  location = var.location
  tags     = local.tags
}

resource "azurerm_storage_account" "tfstate" {
  name                     = var.state_storage_account_name
  resource_group_name      = azurerm_resource_group.tfstate.name
  location                 = azurerm_resource_group.tfstate.location
  account_kind             = "StorageV2"
  account_tier             = "Standard"
  account_replication_type = "LRS"
  access_tier              = "Hot"

  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  # Terraform reads and writes the state with Entra ID (`use_azuread_auth` in the backends):
  # no account key exists that could leak.
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true

  blob_properties {
    # Every version of the state is kept: a broken apply can be rolled back.
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }

  tags = local.tags

  lifecycle {
    # Holds data: deleting it takes a deliberate edit of this file.
    prevent_destroy = true
  }
}

# Whoever runs Terraform (today the owner, later the CI identity) reads and writes the state.
resource "azurerm_role_assignment" "state_writer" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"

  depends_on = [azurerm_role_assignment.state_writer]

  lifecycle {
    # Holds data: deleting it takes a deliberate edit of this file.
    prevent_destroy = true
  }
}
