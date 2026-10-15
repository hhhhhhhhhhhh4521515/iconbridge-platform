# Logs of the Container Apps environment and telemetry of the apps, in one workspace.
# The daily cap stops ingestion for the rest of the day once reached: logs can never
# use up the credit of the subscription.

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-iconbridge-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_in_days
  daily_quota_gb      = var.daily_quota_gb
  tags                = var.tags
}

resource "azurerm_application_insights" "this" {
  name                = "appi-iconbridge-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "web"
  # Keeps a share of the requests and their telemetry; enough to see trends and errors.
  sampling_percentage = var.sampling_percentage
  tags                = var.tags
}
