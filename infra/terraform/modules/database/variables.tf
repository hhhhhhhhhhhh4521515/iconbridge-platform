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

variable "administrator_login" {
  description = "Administrator login of the PostgreSQL server."
  type        = string
  default     = "iconbridge_admin"
}

variable "administrator_password" {
  description = "Administrator password of the PostgreSQL server (generated, kept in Key Vault)."
  type        = string
  sensitive   = true
}

variable "databases" {
  description = "Databases on the server: one per environment (staging shares this server)."
  type        = list(string)
  default     = ["iconbridge"]
}

variable "admin_ip_addresses" {
  description = "Public IPv4 addresses allowed to connect from outside Azure (the administrator's workstation)."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for ip in var.admin_ip_addresses : can(cidrhost("${ip}/32", 0))])
    error_message = "Each entry is one IPv4 address, without a mask."
  }
}
