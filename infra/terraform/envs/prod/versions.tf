terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.81"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.13"
    }
  }

  # State in the storage made by infra/terraform/bootstrap, read and written with Entra ID.
  backend "azurerm" {
    resource_group_name  = "rg-iconbridge-tfstate"
    storage_account_name = "sticonbridgetfstateitn"
    container_name       = "tfstate"
    key                  = "prod.tfstate"
    use_azuread_auth     = true
  }
}

provider "azurerm" {
  features {
    key_vault {
      # Purge protection is on: a destroyed vault stays recoverable for 7 days.
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
  # The subscription comes from ARM_SUBSCRIPTION_ID (.azure-context). Providers are
  # registered already; the student subscription forbids registering others.
  resource_provider_registrations = "none"
  # Storage containers are managed with Entra ID: the accounts have no usable key.
  storage_use_azuread = true
}
