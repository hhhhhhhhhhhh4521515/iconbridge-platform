variable "name_suffix" {
  description = "<env>-<region-short> part of the names, e.g. prod-itn."
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

variable "data_location" {
  description = "Where Communication Services keep their data at rest."
  type        = string
  default     = "Europe"
}

variable "apps_principal_id" {
  description = "Object id of the managed identity that sends the emails."
  type        = string
}

variable "sender_username" {
  description = "Local part of the sender address on the Azure-managed domain."
  type        = string
  default     = "DoNotReply"
}

variable "custom_domain" {
  description = "The site's own email domain, e.g. example.com. Empty: the Azure-managed domain only."
  type        = string
  default     = ""
}

variable "use_custom_domain" {
  description = "Send from custom_sender_username@custom_domain. Only once the domain is verified: Azure refuses to link it before."
  type        = bool
  default     = false

  validation {
    condition     = !var.use_custom_domain || var.custom_domain != ""
    error_message = "use_custom_domain needs custom_domain."
  }
}

variable "custom_sender_username" {
  description = "Local part of the sender address on the custom domain."
  type        = string
  default     = "noreply"
}

variable "display_name" {
  description = "Display name of the sender on the custom domain."
  type        = string
  default     = "IconBridge Recruitment"
}
