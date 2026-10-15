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
