# ADR-018: CI/CD with GitHub Actions and federated Azure identities

Date: 2026-10-16. Status: accepted.

## Context

Prompt 13 asks for pipelines that test every pull request, scan the code and the images, plan and apply Terraform, and deploy to Azure Container Apps after an approval, with an automatic rollback. The repository was private on a free GitHub account: branch protection, rulesets and required reviewers on environments were refused ("Upgrade to GitHub Pro or make this repository public"), and CodeQL and dependency review need paid code security on private repositories. The Azure for Students tenant allows app registrations and federated credentials (docs/00-environment.md).

## Decisions

1. **The repository is public** (the owner's choice, 16 October 2026). It unlocks branch protection, environment reviewers, CodeQL, dependency review and unlimited Actions minutes. Before the change, gitleaks found no secret in the 91 commits (two false positives, the _name_ of a Key Vault secret, are allow-listed); commits use the owner's noreply address.
2. **OpenID Connect, no client secret.** Workflows exchange GitHub's token for an Azure token with `azure/login` or `ARM_USE_OIDC`.
3. **Three identities instead of one**, each federated with one subject:
   - `plan` (`pull_request`): read-only. A pull request runs the workflow file of its own branch, so whatever identity a pull request can obtain must not be able to change production; with Contributor, a branch could delete the database whatever Terraform's `prevent_destroy` says. Planning reads the state, which holds the generated secrets, so this identity can read them: acceptable because only collaborators open same-repository pull requests, and forks get no OIDC token.
   - `push` (`ref:refs/heads/main`): AcrPush only, for the images built after CI.
   - `deploy` (`environment:production`): Contributor on the resource group and data roles on the state, the vault and the files. Usable only by a job of the `production` environment, which waits for the owner's approval and accepts `main` only.
4. **No role assignment rights for CI** (no User Access Administrator, not even constrained). Terraform would need them only when a change adds or removes a role assignment; such a change fails in CI at that resource and the owner applies it locally. Granting the right would let a compromised workflow give itself, or anyone, any role in the resource group. The identities themselves (`infra/terraform/github`) are applied by the owner only.
5. **Production's data roles go to an explicit `owner_object_id`**, not to "whoever runs Terraform" (`azurerm_client_config`), which would flip between the owner and CI on every apply.
6. **Workflows**: `ci.yml`, `security.yml`, `infra.yml`, `deploy.yml`, `release.yml`, described in docs/CICD.md. Actions are pinned to commit SHAs and updated by Dependabot. Images are tagged with the full git SHA and scanned before they are pushed. The deployment and the infrastructure apply share `production` as a concurrency group, so one change of production runs at a time.
7. **Rollback** puts the previous images back (single revision mode creates a new revision); migrations are not rolled back, which is why they must stay compatible with the running version.
8. **Releases from tags** with GitHub's generated notes, not release-please: release-please's pull requests, opened with the workflow token, would not trigger the required checks.

## Consequences

- Anyone can read the code and the documentation; nothing secret is in them, and gitleaks runs on every push.
- A merge to `main` reaches production only after the owner approves the deployment.
- Role assignment changes stay a manual step for the owner.
- Branch protection applies to administrators too: the owner merges through pull requests like everyone.
