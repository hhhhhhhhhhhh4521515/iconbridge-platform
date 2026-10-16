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
