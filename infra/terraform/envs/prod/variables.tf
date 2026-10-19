variable "location" {
  description = "Azure region (docs/00-environment.md): only italynorth has both Container Apps and an unrestricted PostgreSQL B1ms on this subscription."
  type        = string
  default     = "italynorth"

  validation {
    condition     = contains(["italynorth", "germanywestcentral", "spaincentral", "austriaeast", "centralindia"], var.location)
    error_message = "The region must be one the subscription policy allows."
  }
}

variable "owner_email" {
  description = "Owner of the resources: `owner` tag, budget alerts, first super admin of the site."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.owner_email))
    error_message = "owner_email must be an email address."
  }
}

variable "owner_object_id" {
  description = "Entra object id of the owner (az ad signed-in-user show --query id -o tsv). Gets the data roles Terraform needs on the vault and the file storage. Explicit, not \"whoever runs Terraform\": GitHub Actions runs it too (docs/adr/ADR-018-ci-cd.md)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.owner_object_id))
    error_message = "A GUID."
  }
}

variable "admin_ip_addresses" {
  description = "Public IPv4 addresses allowed to reach PostgreSQL from outside Azure (your workstation: curl -s https://api.ipify.org)."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for ip in var.admin_ip_addresses : can(cidrhost("${ip}/32", 0))])
    error_message = "Each entry is one IPv4 address, without a mask."
  }
}

variable "registry_type" {
  description = "\"acr\": Azure Container Registry Standard (free 12 months on this subscription). \"ghcr\": GitHub Container Registry, after the free period."
  type        = string
  default     = "acr"

  validation {
    condition     = contains(["acr", "ghcr"], var.registry_type)
    error_message = "registry_type is \"acr\" or \"ghcr\"."
  }
}

variable "ghcr_owner" {
  description = "registry_type = ghcr: GitHub user or organisation owning the images."
  type        = string
  default     = ""
}

variable "ghcr_username" {
  description = "registry_type = ghcr: GitHub account of the read-only pull token (the token goes in Key Vault)."
  type        = string
  default     = ""
}

variable "enable_budget" {
  description = "Monthly budget with email alerts on the resource group. Budgets are available on this offer (docs/00-environment.md)."
  type        = bool
  default     = true
}

variable "budget_amount" {
  description = "Monthly budget in USD. 15 a month makes the 100 USD credit last the internship."
  type        = number
  default     = 15

  validation {
    condition     = var.budget_amount > 0 && var.budget_amount <= 100
    error_message = "Between 0 and 100 USD."
  }
}

variable "budget_start_date" {
  description = "First day of the first budget month, RFC 3339 (e.g. 2026-10-01T00:00:00Z)."
  type        = string
  default     = "2026-10-01T00:00:00Z"

  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-01T00:00:00Z$", var.budget_start_date))
    error_message = "The first day of a month at midnight UTC, e.g. 2026-10-01T00:00:00Z."
  }
}

variable "enable_custom_domain" {
  description = "Serve the web app on custom_domain with a free managed certificate."
  type        = bool
  default     = false
}

variable "custom_domain" {
  description = "With enable_custom_domain: e.g. jobs.example.com. Its CNAME and TXT records must exist first."
  type        = string
  default     = ""

  validation {
    condition     = var.custom_domain == "" || can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.custom_domain))
    error_message = "A host name such as jobs.example.com."
  }
}

variable "mail_display_name" {
  description = "Display name of the sender DoNotReply@<Azure-managed domain>, set once with az after the first apply (docs/DEPLOYMENT.md)."
  type        = string
  default     = "IconBridge Recruitment"
}

variable "email_hourly_quota" {
  description = "Emails Azure accepts per hour for the subscription: 10 with an Azure-managed domain (cannot be raised). Job alerts use at most half."
  type        = number
  default     = 10

  validation {
    condition     = var.email_hourly_quota >= 2
    error_message = "At least 2, so job alerts get at least one email an hour."
  }
}

variable "trust_proxy_hops" {
  description = "Proxies that add themselves to X-Forwarded-For before the API: the ingress of the web app and the web app itself. Check it after the first deployment (docs/DEPLOYMENT.md)."
  type        = number
  default     = 2

  validation {
    condition     = var.trust_proxy_hops >= 0 && var.trust_proxy_hops <= 5
    error_message = "Between 0 and 5."
  }
}

variable "api_size" {
  description = "API container: 0.5 vCPU / 1 GiB, scale 0 to 2."
  type = object({
    cpu          = number
    memory       = string
    min_replicas = number
    max_replicas = number
  })
  default = { cpu = 0.5, memory = "1Gi", min_replicas = 0, max_replicas = 2 }

  validation {
    condition     = var.api_size.max_replicas <= 2 && var.api_size.min_replicas >= 0
    error_message = "At most 2 replicas: the environment's core quota is small."
  }
}

variable "web_size" {
  description = "Web container: 0.5 vCPU / 1 GiB (Next.js starts and renders the first page twice as fast as with 0.25, ADR-017; billed only while running), scale 0 to 2."
  type = object({
    cpu          = number
    memory       = string
    min_replicas = number
    max_replicas = number
  })
  default = { cpu = 0.5, memory = "1Gi", min_replicas = 0, max_replicas = 2 }

  validation {
    condition     = var.web_size.max_replicas <= 2 && var.web_size.min_replicas >= 0
    error_message = "At most 2 replicas."
  }
}

variable "enable_availability_tests" {
  description = "Availability tests (home page, /api/health/ready) every 15 minutes with their alert. Off: each test wakes the apps from zero, about 25-30 USD a month of compute (ADR-019). Turn on briefly to check them, or for good with a warm replica."
  type        = bool
  default     = false
}
