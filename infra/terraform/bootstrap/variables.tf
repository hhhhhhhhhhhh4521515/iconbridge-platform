variable "location" {
  description = "Azure region. The subscription policy allows italynorth, germanywestcentral, spaincentral, austriaeast and centralindia."
  type        = string
  default     = "italynorth"

  validation {
    condition     = contains(["italynorth", "germanywestcentral", "spaincentral", "austriaeast", "centralindia"], var.location)
    error_message = "The region must be one the subscription policy allows (see docs/00-environment.md)."
  }
}

variable "owner" {
  description = "Value of the `owner` tag: who answers for these resources."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.owner))
    error_message = "owner must be an email address."
  }
}

variable "state_storage_account_name" {
  description = "Globally unique name of the storage account that holds the Terraform state (3-24 lower-case letters and digits)."
  type        = string
  default     = "sticonbridgetfstateitn"

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.state_storage_account_name))
    error_message = "3 to 24 lower-case letters and digits."
  }
}
