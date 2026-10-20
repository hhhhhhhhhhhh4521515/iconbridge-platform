variable "name_suffix" {
  description = "<env>-<region-short>, e.g. prod-itn."
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

variable "retention_in_days" {
  description = "Days logs are kept. 30 is the free minimum of Log Analytics."
  type        = number
  default     = 30

  validation {
    condition     = var.retention_in_days >= 30 && var.retention_in_days <= 730
    error_message = "Between 30 and 730 days."
  }
}

variable "daily_quota_gb" {
  description = "Daily ingestion cap in GB. 0.15 GB a day stays under the 5 GB a month that Log Analytics includes."
  type        = number
  default     = 0.15

  validation {
    condition     = var.daily_quota_gb > 0 && var.daily_quota_gb <= 1
    error_message = "Between 0 and 1 GB a day: logs must never become a significant cost."
  }
}

variable "sampling_percentage" {
  description = "Share of the Application Insights telemetry kept by ingestion sampling, in percent. 100: at this traffic, sampling dropped whole requests and made the 5xx alert blind (ADR-019); the daily cap protects the budget."
  type        = number
  default     = 100

  validation {
    condition     = var.sampling_percentage > 0 && var.sampling_percentage <= 100
    error_message = "Between 0 and 100."
  }
}
