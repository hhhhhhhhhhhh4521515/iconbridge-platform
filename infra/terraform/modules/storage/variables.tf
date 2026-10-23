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

variable "apps_principal_id" {
  description = "Managed identity of the apps: reads and writes files, signs download links."
  type        = string
}

variable "deployer_principal_id" {
  description = "Who runs Terraform: creates the containers."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Origins of the web app (https://...)."
  type        = list(string)
  default     = []
}

variable "log_analytics_workspace_id" {
  description = "Workspace receiving the access logs of the blobs."
  type        = string
}

variable "backup_retention_days" {
  description = "Days a database backup is kept in the backups container before the lifecycle policy deletes it."
  type        = number
  default     = 30
}
