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

variable "alert_email" {
  description = "Where the alerts go (the action group). Not through the app's outbox: an alert must arrive when the app is broken."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Workspace of the container logs and of Application Insights."
  type        = string
}

variable "application_insights_id" {
  description = "Application Insights of the API and the web app."
  type        = string
}

variable "api_app_id" {
  description = "API Container App (restart metric)."
  type        = string
}

variable "web_app_id" {
  description = "Web Container App (restart metric)."
  type        = string
}

variable "tasks_job_name" {
  description = "Name of the Container Apps Job of the scheduled tasks."
  type        = string
}

variable "postgres_server_id" {
  description = "PostgreSQL Flexible Server (CPU alert)."
  type        = string
}

variable "storage_account_id" {
  description = "Storage account of the application files (availability alert)."
  type        = string
}

variable "site_url" {
  description = "Public address of the site, e.g. https://….azurecontainerapps.io (availability tests)."
  type        = string
}

variable "enable_availability_tests" {
  description = "Availability tests every 15 minutes on the home page and /api/health/ready, with their alert. Off by default: each test wakes the apps from zero and keeps them running through their cooldown, about 25-30 USD a month of compute, twice the budget (ADR-019)."
  type        = bool
  default     = false
}

variable "api_role_name" {
  description = "Cloud role name of the API in Application Insights (OTEL_SERVICE_NAME)."
  type        = string
  default     = "iconbridge-api"
}

variable "web_role_name" {
  description = "Cloud role name of the web app in Application Insights."
  type        = string
  default     = "iconbridge-web"
}
