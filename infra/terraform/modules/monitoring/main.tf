# Alerts, availability tests and the operations workbook of production (ADR-019).
#
# Alerts reach the owner through an Azure Monitor action group (email), never through the
# app's outbox: an alert must still arrive when the app or its email quota is the problem.
# Costs: metric alerts about 0.10 USD a month each, log alerts about 0.50 USD (one run
# every 15 minutes or slower); the availability tests are off by default (see the variable).

resource "azurerm_monitor_action_group" "owner" {
  name                = "ag-iconbridge-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  short_name          = "iconbridge"
  tags                = var.tags

  email_receiver {
    name                    = "owner"
    email_address           = var.alert_email
    use_common_alert_schema = true
  }
}

locals {
  action = { action_group_id = azurerm_monitor_action_group.owner.id }
}

# --- The API answers with server errors -------------------------------------------------

resource "azurerm_monitor_metric_alert" "api_5xx" {
  name                = "alert-api-5xx-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.application_insights_id]
  description         = "More than 5 failed API requests (HTTP 5xx) in 5 minutes. Look at Application Insights > Failures, role iconbridge-api."
  severity            = 1
  frequency           = "PT1M"
  window_size         = "PT5M"
  tags                = var.tags

  criteria {
    metric_namespace = "microsoft.insights/components"
    metric_name      = "requests/failed"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 5

    dimension {
      name     = "cloud/roleName"
      operator = "Include"
      values   = [var.api_role_name]
    }
  }

  action {
    action_group_id = local.action.action_group_id
  }
}

# --- Database and file storage ----------------------------------------------------------

resource "azurerm_monitor_metric_alert" "postgres_cpu" {
  name                = "alert-postgres-cpu-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "PostgreSQL CPU above 80 % for 15 minutes (B1ms, burstable: credits may run out)."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = local.action.action_group_id
  }
}

# Availability counts server errors and throttling, not a missing file (404): uploads and
# download links that fail on Azure's side.
resource "azurerm_monitor_metric_alert" "storage_availability" {
  name                = "alert-storage-failures-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.storage_account_id]
  description         = "Blob storage availability below 99 % over 15 minutes: uploads or download links fail."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.Storage/storageAccounts"
    metric_name      = "Availability"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 99
  }

  action {
    action_group_id = local.action.action_group_id
  }
}

# --- Scheduled tasks and emails (container logs) ------------------------------------------

# The tasks job prints one JSON line per task ({"task": …, "ok": …}) and exits with 1 when
# one fails; Container Apps then logs the execution as failed. It runs every 15 minutes:
# no send-emails report in an hour means it does not run at all.
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "tasks" {
  name                 = "alert-tasks-${var.name_suffix}"
  resource_group_name  = var.resource_group_name
  location             = var.location
  scopes               = [var.log_analytics_workspace_id]
  description          = "A scheduled task failed, or the tasks job did not run for an hour (emails to retry, closing jobs, job alerts, retention)."
  severity             = 2
  evaluation_frequency = "PT15M"
  window_duration      = "PT1H"
  tags                 = var.tags

  criteria {
    query                   = <<-KQL
      let reports = ContainerAppConsoleLogs_CL
        | where ContainerJobName_s == "${var.tasks_job_name}"
        | extend report = parse_json(Log_s)
        | where isnotempty(tostring(report.task));
      let failedTasks = toscalar(reports | where tobool(report.ok) == false | count);
      let failedRuns = toscalar(ContainerAppSystemLogs_CL
        | where JobName_s == "${var.tasks_job_name}" and Reason_s == "SawCompletedJob" and Log_s has "Failed"
        | count);
      let runs = toscalar(reports | where tostring(report.task) == "send-emails" | count);
      print failedTasks, failedRuns, runs
      | where failedTasks > 0 or failedRuns > 0 or runs == 0
    KQL
    time_aggregation_method = "Count"
    operator                = "GreaterThan"
    threshold               = 0
  }

  action {
    action_groups = [local.action.action_group_id]
  }
}

# An email is given up after about three days of failed attempts (20 attempts): the API
# and the tasks job log "Email not sent: … given up".
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "emails_abandoned" {
  name                 = "alert-emails-abandoned-${var.name_suffix}"
  resource_group_name  = var.resource_group_name
  location             = var.location
  scopes               = [var.log_analytics_workspace_id]
  description          = "Emails abandoned by the outbox after all their retries. Look at email_outbox (status FAILED) and the mail service."
  severity             = 2
  evaluation_frequency = "PT1H"
  window_duration      = "PT1H"
  tags                 = var.tags

  criteria {
    query                   = <<-KQL
      ContainerAppConsoleLogs_CL
      | where Log_s has "Email not sent" and Log_s has "given up"
    KQL
    time_aggregation_method = "Count"
    operator                = "GreaterThan"
    threshold               = 0
  }

  action {
    action_groups = [local.action.action_group_id]
  }
}

# --- Availability tests (off by default: they keep the apps awake) ------------------------

locals {
  availability_tests = var.enable_availability_tests ? {
    home   = { path = "/en", content = "IconBridge" }
    health = { path = "/api/health/ready", content = "\"status\":\"ok\"" }
  } : {}
}

resource "azurerm_application_insights_standard_web_test" "site" {
  for_each = local.availability_tests

  name                    = "webtest-${each.key}-${var.name_suffix}"
  resource_group_name     = var.resource_group_name
  location                = var.location
  application_insights_id = var.application_insights_id
  description             = "GET ${each.value.path} every 15 minutes."
  # One location (West Europe): every location is billed per run and wakes the apps.
  geo_locations = ["emea-nl-ams-azr"]
  frequency     = 900
  # A cold start (both apps at zero) takes about 60 s.
  timeout = 120
  enabled = true
  tags    = var.tags

  request {
    url = "${var.site_url}${each.value.path}"
  }

  validation_rules {
    expected_status_code        = 200
    ssl_check_enabled           = true
    ssl_cert_remaining_lifetime = 7

    content {
      content_match      = each.value.content
      pass_if_text_found = true
    }
  }
}

resource "azurerm_monitor_metric_alert" "availability" {
  for_each = azurerm_application_insights_standard_web_test.site

  name                = "alert-availability-${each.key}-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  scopes              = [each.value.id, var.application_insights_id]
  description         = "The availability test of ${each.value.description} fails."
  severity            = 1
  tags                = var.tags

  application_insights_web_test_location_availability_criteria {
    web_test_id           = each.value.id
    component_id          = var.application_insights_id
    failed_location_count = 1
  }

  action {
    action_group_id = local.action.action_group_id
  }
}

# --- Workbook -----------------------------------------------------------------------------

locals {
  roles = "'${var.api_role_name}', '${var.web_role_name}'"
  kql = {
    requests  = "AppRequests | where AppRoleName in (${local.roles}) | summarize Requests = sum(ItemCount) by bin(TimeGenerated, 1m), AppRoleName"
    latency   = "AppRequests | where AppRoleName in (${local.roles}) | summarize p95 = percentile(DurationMs, 95) by bin(TimeGenerated, 5m), AppRoleName"
    errors    = "AppRequests | where AppRoleName in (${local.roles}) | summarize Total = sum(ItemCount), Failed = sumif(ItemCount, toint(ResultCode) >= 500) by bin(TimeGenerated, 5m), AppRoleName | extend ErrorRate = round(100.0 * Failed / Total, 2) | project TimeGenerated, AppRoleName, ErrorRate"
    perDay    = "AppEvents | where Name == 'application_submitted' | summarize Applications = sum(ItemCount) by bin(TimeGenerated, 1d)"
    events    = "AppEvents | where Name in ('application_submitted', 'status_changed', 'cooldown_blocked') | summarize Count = sum(ItemCount) by Name"
    tasks     = "ContainerAppConsoleLogs_CL | where ContainerJobName_s == '${var.tasks_job_name}' | extend report = parse_json(Log_s) | where isnotempty(tostring(report.task)) | summarize Runs = count(), Failed = countif(tobool(report.ok) == false) by Task = tostring(report.task)"
    exception = "AppExceptions | where AppRoleName in (${local.roles}) | summarize Count = sum(ItemCount) by ExceptionType, AppRoleName | top 10 by Count"
  }
  query_item = { for key, query in local.kql : key => {
    version                 = "KqlItem/1.0"
    query                   = query
    size                    = 0
    queryType               = 0
    resourceType            = "microsoft.operationalinsights/workspaces"
    crossComponentResources = [var.log_analytics_workspace_id]
  } }
}

resource "azurerm_application_insights_workbook" "operations" {
  name                = uuidv5("url", "https://iconbridge/workbooks/operations/${var.name_suffix}")
  resource_group_name = var.resource_group_name
  location            = var.location
  display_name        = "IconBridge Jobs – operations (${var.name_suffix})"
  source_id           = lower(var.application_insights_id)
  category            = "workbook"
  tags                = var.tags

  data_json = jsonencode({
    version = "Notebook/1.0"
    items = [
      {
        type = 1
        name = "title"
        content = { json = join("\n", [
          "## IconBridge Jobs – production",
          "Requests and latency of the API and the web app (Application Insights, sampling 100 %), applications submitted, scheduled tasks and container restarts. Times in UTC; the apps scale to zero, so empty periods are normal at night.",
        ]) }
      },
      { type = 9, name = "range", content = {
        version = "KqlParameterItem/1.0"
        parameters = [{
          id    = "8f6a2f1e-7c1c-4f3e-9d3b-1a2b3c4d5e6f", version = "KqlParameterItem/1.0", name = "TimeRange", type = 4
          value = { durationMs = 86400000 }
          typeSettings = { selectableValues = [
            { durationMs = 3600000 }, { durationMs = 86400000 }, { durationMs = 604800000 }, { durationMs = 2592000000 },
          ] }
        }]
      } },
      { type = 3, name = "requests-per-minute", content = merge(local.query_item.requests, { title = "Requests per minute", visualization = "timechart", timeContextFromParameter = "TimeRange" }) },
      { type = 3, name = "latency-p95", content = merge(local.query_item.latency, { title = "Latency p95 (ms)", visualization = "timechart", timeContextFromParameter = "TimeRange" }) },
      { type = 3, name = "error-rate", content = merge(local.query_item.errors, { title = "Error rate (% of requests with HTTP 5xx)", visualization = "timechart", timeContextFromParameter = "TimeRange" }) },
      { type = 3, name = "applications-per-day", content = merge(local.query_item.perDay, { title = "Applications submitted per day", visualization = "barchart", timeContext = { durationMs = 2592000000 } }) },
      { type = 3, name = "business-events", content = merge(local.query_item.events, { title = "Business events in the period", visualization = "table", timeContextFromParameter = "TimeRange" }) },
      { type = 3, name = "tasks", content = merge(local.query_item.tasks, { title = "Scheduled tasks (runs and failures)", visualization = "table", timeContextFromParameter = "TimeRange" }) },
      { type = 3, name = "exceptions", content = merge(local.query_item.exception, { title = "Exceptions by type", visualization = "table", timeContextFromParameter = "TimeRange" }) },
      { type = 10, name = "container-restarts", content = {
        chartId      = "container-restarts"
        version      = "MetricsItem/2.0"
        size         = 0
        chartType    = 2
        resourceType = "microsoft.app/containerapps"
        metricScope  = 0
        resourceIds  = [var.api_app_id, var.web_app_id]
        timeContext  = { durationMs = 604800000 }
        metrics = [{
          namespace   = "microsoft.app/containerapps"
          metric      = "microsoft.app/containerapps--RestartCount"
          aggregation = 1
        }]
        title = "Container restarts (7 days)"
      } },
    ]
    fallbackResourceIds = [var.log_analytics_workspace_id]
    "$schema"           = "https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json"
  })
}
