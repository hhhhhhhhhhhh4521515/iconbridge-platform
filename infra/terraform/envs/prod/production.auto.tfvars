# Settings of production that are not secret, reviewed in pull requests. Terraform reads
# this file after terraform.tfvars (the TF_VARS_PROD secret in GitHub Actions: owner,
# administrator address), so a value here wins over the same one there.

# 40 USD a month since both apps keep a warm replica (ADR-022).
budget_amount = 40
