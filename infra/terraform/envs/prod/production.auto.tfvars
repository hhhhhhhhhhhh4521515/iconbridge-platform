# Settings of production that are not secret, reviewed in pull requests. Terraform reads
# this file after terraform.tfvars (the TF_VARS_PROD secret in GitHub Actions: owner,
# administrator address), so a value here wins over the same one there.

# 40 USD a month since both apps keep a warm replica (ADR-022).
budget_amount = 40

# The site's own domain, DNS at Cloudflare, records "DNS only" (ADR-023), enabled on
# 28 October 2026 once the records resolved.
custom_domain         = "iconbridgerecruitment.com"
custom_domain_aliases = ["www.iconbridgerecruitment.com"]
enable_custom_domain  = true

# Emails from noreply@iconbridgerecruitment.com (domain verified on 28 October 2026).
email_domain     = "iconbridgerecruitment.com"
use_email_domain = true

# Audit H1 part 1 (ADR-026): no workstation address is allowed through the firewall any more
# (overrides TF_VARS_PROD). The apps keep the password until the identity owns the tables:
# every object belongs to the password administrator, so the identity would be refused on them.
database_auth      = "password"
admin_ip_addresses = []
