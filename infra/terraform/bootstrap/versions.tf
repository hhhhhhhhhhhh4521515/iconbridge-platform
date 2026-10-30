terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.11"
    }
  }
  # Local state on purpose: this configuration creates the storage that holds the state
  # of the others. Applied once; `terraform.tfstate` stays on this machine (git-ignored).
}

provider "azurerm" {
  features {}
  # The subscription is chosen by ARM_SUBSCRIPTION_ID (from .azure-context).
  # The needed resource providers are registered already (docs/00-environment.md).
  resource_provider_registrations = "none"
  # No account key is ever used: containers are managed with Entra ID.
  storage_use_azuread = true
}
