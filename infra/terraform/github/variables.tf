variable "github_repository" {
  description = "owner/name of the GitHub repository whose workflows sign in to Azure."
  type        = string
  default     = "hhhhhhhhhhhh4521515/iconbridge-platform"

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "owner/name, e.g. octocat/iconbridge-platform."
  }
}

variable "registry_name" {
  description = "Azure Container Registry the images are pushed to (registry_type = \"acr\"). Empty with GitHub Container Registry."
  type        = string
  default     = "acriconbridgeproditn"
}

variable "github_owner_id" {
  description = "Numeric id of the repository owner (gh api repos/OWNER/REPO -q .owner.id). GitHub puts it in the OIDC subject (immutable subjects)."
  type        = number
  default     = 153290247
}

variable "github_repository_id" {
  description = "Numeric id of the repository (gh api repos/OWNER/REPO -q .id). Renaming the repository or its owner does not change it."
  type        = number
  default     = 1413348591
}
