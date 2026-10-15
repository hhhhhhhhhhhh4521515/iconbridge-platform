variable "registry_type" {
  description = "\"acr\" (Azure Container Registry) or \"ghcr\" (GitHub Container Registry)."
  type        = string

  validation {
    condition     = contains(["acr", "ghcr"], var.registry_type)
    error_message = "registry_type is \"acr\" or \"ghcr\"."
  }
}

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

variable "pull_principal_id" {
  description = "Principal that pulls the images (the managed identity of the apps)."
  type        = string
}

variable "ghcr_owner" {
  description = "GitHub user or organisation that owns the images on ghcr.io (registry_type = \"ghcr\")."
  type        = string
  default     = ""
}
