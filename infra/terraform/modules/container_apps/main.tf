# The Container Apps environment, the two apps and the two jobs.
#
#   internet ──HTTPS──▶ web (external ingress) ──/api/v1/*──▶ api (internal ingress)
#   migrate job (manual, before each deployment)     tasks job (cron, every 15 min)
#   backup job (cron, weekly pg_dump to the backups container)
#
# The environment itself is created by envs/prod (variable environment_id): the
# subscription allows one per region, so a staging app would live in it too.
#
# Images: the first apply uses public placeholder images, because the real ones are
# pushed after the registry exists. The pipeline (or `az containerapp update`) then sets
# the image, and Terraform ignores that attribute.

locals {
  uses_identity_pull = var.registry_type == "acr"

  # Secrets each workload needs, by Key Vault secret name. Container Apps fetch them with
  # the managed identity; the values never appear in the app configuration.
  api_secret_names      = toset(values(var.api_secret_env))
  web_secret_names      = toset(values(var.web_secret_env))
  migrate_secret_names  = toset(values(var.migrate_secret_env))
  registry_secret_names = local.uses_identity_pull ? toset([]) : toset([var.registry_password_secret_name])
}

# ---------------------------------------------------------------------------
# API: internal ingress only. The browser never calls it; the web app forwards /api/v1/*
# so the session cookies stay on the site's own address.

resource "azurerm_container_app" "api" {
  name                         = "ca-iconbridge-api-${var.name_suffix}"
  container_app_environment_id = var.environment_id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server               = var.registry_server
    identity             = local.uses_identity_pull ? var.identity_id : null
    username             = local.uses_identity_pull ? null : var.registry_username
    password_secret_name = local.uses_identity_pull ? null : var.registry_password_secret_name
  }

  dynamic "secret" {
    for_each = setunion(local.api_secret_names, local.registry_secret_names)
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_ids[secret.value]
      identity            = var.identity_id
    }
  }

  ingress {
    external_enabled = false
    target_port      = 4000
    transport        = "auto"
    # Plain HTTP between the apps of the environment; nothing outside can reach it.
    allow_insecure_connections = true

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.api.min_replicas
    max_replicas = var.api.max_replicas

    container {
      name   = "api"
      image  = var.placeholder_image
      cpu    = var.api.cpu
      memory = var.api.memory

      dynamic "env" {
        for_each = var.api_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.api_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      # Cold starts (ADR-017): the startup probe asks every second from the start (no
      # initial delay), so traffic is let in as soon as the API listens; up to 60 s.
      startup_probe {
        transport               = "HTTP"
        port                    = 4000
        path                    = "/health/live"
        interval_seconds        = 1
        timeout                 = 1
        failure_count_threshold = 60
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 4000
        path                    = "/health/live"
        interval_seconds        = 30
        timeout                 = 3
        failure_count_threshold = 3
      }

      # Every 3 s, and 3 s to answer: the first check may open the first database connection.
      readiness_probe {
        transport               = "HTTP"
        port                    = 4000
        path                    = "/health/ready"
        interval_seconds        = 3
        timeout                 = 3
        failure_count_threshold = 3
      }
    }

    http_scale_rule {
      name                = "http"
      concurrent_requests = "50"
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# ---------------------------------------------------------------------------
# Web: the only public entry.

resource "azurerm_container_app" "web" {
  name                         = "ca-iconbridge-web-${var.name_suffix}"
  container_app_environment_id = var.environment_id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server               = var.registry_server
    identity             = local.uses_identity_pull ? var.identity_id : null
    username             = local.uses_identity_pull ? null : var.registry_username
    password_secret_name = local.uses_identity_pull ? null : var.registry_password_secret_name
  }

  dynamic "secret" {
    for_each = setunion(local.web_secret_names, local.registry_secret_names)
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_ids[secret.value]
      identity            = var.identity_id
    }
  }

  ingress {
    external_enabled           = true
    target_port                = 3000
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.web.min_replicas
    max_replicas = var.web.max_replicas

    container {
      name   = "web"
      image  = var.placeholder_image
      cpu    = var.web.cpu
      memory = var.web.memory

      dynamic "env" {
        for_each = var.web_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.web_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      # The web app's own health: it does not call the API, so probes never keep the API
      # awake.
      startup_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/api/health/live"
        interval_seconds        = 1
        timeout                 = 1
        failure_count_threshold = 60
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/api/health/live"
        interval_seconds        = 30
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/api/health/live"
        interval_seconds        = 3
        timeout                 = 3
        failure_count_threshold = 3
      }
    }

    http_scale_rule {
      name                = "http"
      concurrent_requests = "50"
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# ---------------------------------------------------------------------------
# Jobs

# Before each deployment: migrations, then reference data and the first super admin.
resource "azurerm_container_app_job" "migrate" {
  name                         = "caj-iconbridge-migrate-${var.name_suffix}"
  location                     = var.location
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.environment_id
  replica_timeout_in_seconds   = 600
  replica_retry_limit          = 0
  tags                         = var.tags

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server               = var.registry_server
    identity             = local.uses_identity_pull ? var.identity_id : null
    username             = local.uses_identity_pull ? null : var.registry_username
    password_secret_name = local.uses_identity_pull ? null : var.registry_password_secret_name
  }

  dynamic "secret" {
    for_each = setunion(local.migrate_secret_names, local.registry_secret_names)
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_ids[secret.value]
      identity            = var.identity_id
    }
  }

  template {
    container {
      name   = "migrate"
      image  = var.placeholder_job_image
      cpu    = 0.5
      memory = "1Gi"

      dynamic "env" {
        for_each = var.migrate_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# The scheduled tasks (emails to retry, closing jobs, job alerts, retention), with the API
# image and the API settings. Runs while the API itself is scaled to zero.
resource "azurerm_container_app_job" "tasks" {
  name                         = "caj-iconbridge-tasks-${var.name_suffix}"
  location                     = var.location
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.environment_id
  replica_timeout_in_seconds   = 300
  replica_retry_limit          = 0
  tags                         = var.tags

  schedule_trigger_config {
    cron_expression          = var.tasks_cron
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server               = var.registry_server
    identity             = local.uses_identity_pull ? var.identity_id : null
    username             = local.uses_identity_pull ? null : var.registry_username
    password_secret_name = local.uses_identity_pull ? null : var.registry_password_secret_name
  }

  dynamic "secret" {
    for_each = setunion(local.api_secret_names, local.registry_secret_names)
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_ids[secret.value]
      identity            = var.identity_id
    }
  }

  template {
    container {
      name    = "tasks"
      image   = var.placeholder_job_image
      command = ["node", "dist/cli.js", "all"]
      cpu     = 0.5
      memory  = "1Gi"

      dynamic "env" {
        for_each = var.api_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.api_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# Weekly logical backup (ADR-020): pg_dump to the private backups container, with the
# identity of the apps (Storage Blob Data Contributor on the account). Image
# iconbridge-backup (infra/backup), set by the deployment pipeline.
resource "azurerm_container_app_job" "backup" {
  name                         = "caj-iconbridge-backup-${var.name_suffix}"
  location                     = var.location
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.environment_id
  replica_timeout_in_seconds   = 1800
  replica_retry_limit          = 1
  tags                         = var.tags

  schedule_trigger_config {
    cron_expression          = var.backup_cron
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server               = var.registry_server
    identity             = local.uses_identity_pull ? var.identity_id : null
    username             = local.uses_identity_pull ? null : var.registry_username
    password_secret_name = local.uses_identity_pull ? null : var.registry_password_secret_name
  }

  dynamic "secret" {
    for_each = setunion(toset(["database-url"]), local.registry_secret_names)
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_ids[secret.value]
      identity            = var.identity_id
    }
  }

  template {
    container {
      name   = "backup"
      image  = var.placeholder_job_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }

      env {
        name  = "BACKUP_CONTAINER_URL"
        value = var.backup_container_url
      }

      env {
        name  = "AZURE_CLIENT_ID"
        value = var.identity_client_id
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# ---------------------------------------------------------------------------
# Optional custom domains with free managed certificates, for the web app only (the API
# has no public address). The DNS records must exist first (output dns_records of the
# environment): for an apex domain an A record to the environment's IP, for a subdomain a
# CNAME to the default address of the web app, and for each a TXT `asuid.<name>` with the
# verification id.
#
# Terraform adds each host name (unbound) and asks Azure for its certificate, which Azure
# issues and renews itself. The provider cannot bind a managed certificate, so the last
# step is one `az containerapp hostname bind` per name (docs/DEPLOYMENT.md); the binding
# is then ignored here.

resource "azurerm_container_app_custom_domain" "web" {
  for_each = var.custom_domains

  name             = each.key
  container_app_id = azurerm_container_app.web.id

  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "web" {
  for_each = var.custom_domains

  name                         = "mc-${replace(each.key, ".", "-")}"
  container_app_environment_id = var.environment_id
  subject_name                 = each.key
  domain_control_validation    = each.value
  tags                         = var.tags

  # Azure validates the host name through the app that carries it.
  depends_on = [azurerm_container_app_custom_domain.web]
}
