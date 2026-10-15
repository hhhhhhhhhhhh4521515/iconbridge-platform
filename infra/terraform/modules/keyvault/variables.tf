variable "name_suffix" {
  description = "<env>-<region-short> part of the names, e.g. prod-itn."
  type        = string
}

variable "location" {
  description = "Azure region of the resources."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group of the resources."
  type        = string
}

variable "tags" {
  description = "Tags of every resource: project, env, owner, managed-by."
  type        = map(string)
}

variable "tenant_id" {
  description = "Entra ID tenant of the vault."
  type        = string
}

variable "deployer_principal_id" {
  description = "Who runs Terraform (the owner today, the CI identity later): writes the secrets."
  type        = string
}

variable "apps_principal_id" {
  description = "Managed identity of the apps: reads the secrets."
  type        = string
}

variable "generated_secrets" {
  description = "Secret name => value, written by Terraform."
  type        = map(string)
  sensitive   = true
}

variable "external_secrets" {
  description = "Names of the secrets set by hand after the first apply."
  type        = list(string)
  default     = []
}
