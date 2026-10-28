# Settings of production that are not secret, reviewed in pull requests. Terraform reads
# this file after terraform.tfvars (the TF_VARS_PROD secret in GitHub Actions: owner,
# administrator address), so a value here wins over the same one there.

# 40 USD a month since both apps keep a warm replica (ADR-022).
budget_amount = 40

# The site's own domain, DNS at Cloudflare, records "DNS only" (ADR-023). The names give
# the DNS records (output dns_records); the switches wait for them.
custom_domain         = "iconbridgerecruitment.com"
custom_domain_aliases = ["www.iconbridgerecruitment.com"]
enable_custom_domain  = false

# Emails from noreply@iconbridgerecruitment.com once the domain is verified.
email_domain     = "iconbridgerecruitment.com"
use_email_domain = false
