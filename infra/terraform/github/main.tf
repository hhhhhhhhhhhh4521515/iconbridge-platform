# Identities of GitHub Actions in Azure: OpenID Connect federation, no client secret.
# Three app registrations, so a workflow only ever holds the rights its trigger needs
# (docs/adr/ADR-018-ci-cd.md):
#
# | Identity | Federated subject                  | Rights                                              |
# | -------- | ---------------------------------- | --------------------------------------------------- |
# | plan     | pull_request                       | read: resource group, state, secrets, file metadata |
# | push     | ref:refs/heads/main                | push images to the registry                         |
# | deploy   | environment:production (approved)  | change the resource group, state, secrets, files    |
#
# A pull request runs the workflow file of its own branch, so the identity a pull request
# can use must not be able to change production. None of them may assign roles: the role
# assignments of production are applied by the owner (make tf-apply), as these are.

data "azurerm_client_config" "current" {}

data "azurerm_resource_group" "prod" {
  name = "rg-iconbridge-prod"
}

data "azurerm_storage_account" "tfstate" {
  name                = "sticonbridgetfstateitn"
  resource_group_name = "rg-iconbridge-tfstate"
}

data "azurerm_storage_account" "app" {
  name                = "sticonbridgeproditn"
  resource_group_name = data.azurerm_resource_group.prod.name
}

data "azurerm_key_vault" "prod" {
  name                = "kv-iconbridge-prod-itn"
  resource_group_name = data.azurerm_resource_group.prod.name
}

data "azurerm_container_registry" "images" {
  count               = var.registry_name == "" ? 0 : 1
  name                = var.registry_name
  resource_group_name = data.azurerm_resource_group.prod.name
}

locals {
  issuer   = "https://token.actions.githubusercontent.com"
  audience = "api://AzureADTokenExchange"
  subjects = {
    plan   = "repo:${var.github_repository}:pull_request"
    push   = "repo:${var.github_repository}:ref:refs/heads/main"
    deploy = "repo:${var.github_repository}:environment:production"
  }

  # (identity, scope, role) triples, flattened below.
  roles = concat(
    [
      { who = "plan", scope = data.azurerm_resource_group.prod.id, role = "Reader" },
      { who = "plan", scope = data.azurerm_storage_account.tfstate.id, role = "Reader" },
      # The state holds generated secrets: whoever can plan can read them.
      { who = "plan", scope = data.azurerm_storage_account.tfstate.id, role = "Storage Blob Data Reader" },
      { who = "plan", scope = data.azurerm_key_vault.prod.id, role = "Key Vault Secrets User" },
      { who = "plan", scope = data.azurerm_storage_account.app.id, role = "Storage Blob Data Reader" },

      { who = "deploy", scope = data.azurerm_resource_group.prod.id, role = "Contributor" },
      { who = "deploy", scope = data.azurerm_storage_account.tfstate.id, role = "Reader" },
      { who = "deploy", scope = data.azurerm_storage_account.tfstate.id, role = "Storage Blob Data Contributor" },
      { who = "deploy", scope = data.azurerm_key_vault.prod.id, role = "Key Vault Secrets Officer" },
      { who = "deploy", scope = data.azurerm_storage_account.app.id, role = "Storage Blob Data Contributor" },
    ],
    [for registry in data.azurerm_container_registry.images : { who = "push", scope = registry.id, role = "AcrPush" }],
  )
}

resource "azuread_application" "github" {
  for_each     = local.subjects
  display_name = "iconbridge-github-${each.key}"
  owners       = [data.azurerm_client_config.current.object_id]
  notes        = "GitHub Actions of ${var.github_repository} (${each.key}). Managed by infra/terraform/github."
}

resource "azuread_service_principal" "github" {
  for_each  = local.subjects
  client_id = azuread_application.github[each.key].client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

# No client secret exists: GitHub's OIDC token for this exact subject is exchanged for an
# Azure token.
resource "azuread_application_federated_identity_credential" "github" {
  for_each       = local.subjects
  application_id = azuread_application.github[each.key].id
  display_name   = "github-${each.key}"
  description    = "GitHub Actions: ${each.value}"
  issuer         = local.issuer
  audiences      = [local.audience]
  subject        = each.value
}

resource "azurerm_role_assignment" "github" {
  for_each = { for r in local.roles : "${r.who}|${r.role}|${r.scope}" => r }

  scope                = each.value.scope
  role_definition_name = each.value.role
  principal_id         = azuread_service_principal.github[each.value.who].object_id
  principal_type       = "ServicePrincipal"
  description          = "GitHub Actions (${each.value.who})"
}
