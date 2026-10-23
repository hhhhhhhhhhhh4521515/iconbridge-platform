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

variable "environment_id" {
  description = "The Container Apps environment (one per region on this subscription)."
  type        = string
}

variable "identity_id" {
  description = "User-assigned identity of the apps and jobs."
  type        = string
}

variable "registry_type" {
  description = "\"acr\" or \"ghcr\": where the images are pulled from."
  type        = string
}

variable "registry_server" {
  description = "Host of the registry the apps pull from."
  type        = string
}

variable "registry_username" {
  description = "ghcr only: the GitHub account of the pull token."
  type        = string
  default     = ""
}

variable "registry_password_secret_name" {
  description = "ghcr only: Key Vault secret holding the pull token."
  type        = string
  default     = "ghcr-pull-token"
}

variable "secret_ids" {
  description = "Key Vault secret name => versionless id."
  type        = map(string)
}

variable "api_env" {
  description = "Plain settings of the API and of the tasks job."
  type        = map(string)
}

variable "api_secret_env" {
  description = "Variable of the API => Key Vault secret name."
  type        = map(string)
}

variable "web_env" {
  description = "Plain settings of the web app."
  type        = map(string)
}

variable "web_secret_env" {
  description = "Variable of the web app => Key Vault secret name."
  type        = map(string)
}

variable "migrate_secret_env" {
  description = "Variable of the migration job => Key Vault secret name."
  type        = map(string)
}

variable "api" {
  description = "Size and scale of the API. CPU and memory go in pairs (0.25/0.5Gi, 0.5/1Gi, ...)."
  type = object({
    cpu          = number
    memory       = string
    min_replicas = number
    max_replicas = number
  })
}

variable "web" {
  description = "Size and scale of the web app."
  type = object({
    cpu          = number
    memory       = string
    min_replicas = number
    max_replicas = number
  })
}

variable "placeholder_image" {
  description = "Public image of the first apply, before the real images exist."
  type        = string
  default     = "mcr.microsoft.com/k8se/quickstart:latest"
}

variable "placeholder_job_image" {
  description = "Public image of the jobs on the first apply."
  type        = string
  default     = "mcr.microsoft.com/k8se/quickstart-jobs:latest"
}

variable "tasks_cron" {
  description = "Schedule of the tasks job (UTC)."
  type        = string
  default     = "*/15 * * * *"
}

variable "backup_cron" {
  description = "Schedule of the database backup job (UTC). Weekly, Sunday 03:00."
  type        = string
  default     = "0 3 * * 0"
}

variable "backup_container_url" {
  description = "Private container the backup job writes to."
  type        = string
}

variable "identity_client_id" {
  description = "Client id of the user-assigned identity (AZURE_CLIENT_ID of the backup job)."
  type        = string
}

variable "custom_domain" {
  description = "Custom domain of the web app, e.g. jobs.example.com. Empty: the default Azure address only."
  type        = string
  default     = ""
}
