# Terraform for the Azure infrastructure (infra/terraform). See docs/DEPLOYMENT.md.
#
#   make tf-bootstrap        once: the storage of the Terraform state (local state)
#   make tf-init             init an environment (ENV=prod by default)
#   make tf-plan             plan, saved to infra/terraform/envs/$(ENV)/tfplan
#   make tf-apply            apply the saved plan
#   make tf-destroy          destroy an environment, after typing its name
#   make tf-check            fmt, validate, tflint, checkov
#   make tf-plan ENV=github  the identities of GitHub Actions (owner only, docs/CICD.md)
#
# Every target loads the subscription and tenant ids from .azure-context (git-ignored)
# and uses the Azure CLI login (`az login`).

ENV ?= prod
TF_DIR := infra/terraform
# ENV=github: the identities of GitHub Actions (infra/terraform/github), applied by the owner only.
ENV_DIR := $(if $(filter github,$(ENV)),$(TF_DIR)/github,$(TF_DIR)/envs/$(ENV))
AZ_CONTEXT := set -a; . ./.azure-context; set +a;

.PHONY: tf-bootstrap tf-init tf-plan tf-apply tf-destroy tf-fmt tf-validate tf-lint tf-checkov tf-check

tf-bootstrap:
	@test -f $(TF_DIR)/bootstrap/terraform.tfvars || { echo "Create $(TF_DIR)/bootstrap/terraform.tfvars first (owner = \"you@example.com\")"; exit 1; }
	$(AZ_CONTEXT) cd $(TF_DIR)/bootstrap && terraform init -input=false && terraform apply

tf-init:
	$(AZ_CONTEXT) cd $(ENV_DIR) && terraform init -input=false

tf-plan:
	@test -f $(ENV_DIR)/terraform.tfvars -o "$(ENV)" = github || { echo "Copy $(ENV_DIR)/terraform.tfvars.example to terraform.tfvars and fill it in"; exit 1; }
	$(AZ_CONTEXT) cd $(ENV_DIR) && terraform plan -input=false -out=tfplan

tf-apply:
	@test -f $(ENV_DIR)/tfplan || { echo "Run make tf-plan ENV=$(ENV) first"; exit 1; }
	$(AZ_CONTEXT) cd $(ENV_DIR) && terraform apply -input=false tfplan && rm -f tfplan

# The database, the file storage and the state storage have prevent_destroy: Terraform
# refuses to delete them until those lines are removed on purpose. Deleting them deletes
# the data of the site.
tf-destroy:
	@printf 'This destroys the "%s" environment of IconBridge Jobs. Type its name to go on: ' "$(ENV)"; \
	read answer; [ "$$answer" = "$(ENV)" ] || { echo "Cancelled."; exit 1; }
	$(AZ_CONTEXT) cd $(ENV_DIR) && terraform destroy -input=false

tf-fmt:
	terraform fmt -recursive -check -diff $(TF_DIR)

tf-validate:
	for dir in $(TF_DIR)/bootstrap $(TF_DIR)/github $(TF_DIR)/envs/*/; do \
	  [ -f $$dir/versions.tf ] || continue; \
	  (cd $$dir && terraform init -backend=false -input=false >/dev/null && terraform validate) || exit 1; \
	done

tf-lint:
	cd $(TF_DIR) && tflint --init --config "$$PWD/.tflint.hcl" >/dev/null && tflint --recursive --config "$$PWD/.tflint.hcl"

tf-checkov:
	checkov -d $(TF_DIR) --config-file $(TF_DIR)/.checkov.yaml

tf-check: tf-fmt tf-validate tf-lint tf-checkov
