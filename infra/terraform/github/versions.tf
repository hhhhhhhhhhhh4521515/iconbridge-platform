terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.10"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.9"
    }
  }

  # Same state storage as production, its own key. Applied by the owner only: these
  # resources give GitHub Actions its rights, so GitHub Actions never changes them.
  backend "azurerm" {
    resource_group_name  = "rg-iconbridge-tfstate"
    storage_account_name = "sticonbridgetfstateitn"
    container_name       = "tfstate"
    key                  = "github.tfstate"
    use_azuread_auth     = true
  }
}

provider "azurerm" {
  features {}
  resource_provider_registrations = "none"
  storage_use_azuread             = true
}

# The tenant of the az login session (ARM_TENANT_ID from .azure-context).
provider "azuread" {}
