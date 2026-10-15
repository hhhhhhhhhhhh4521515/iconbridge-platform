# ADR-014: Production email through Azure Communication Services

Date: 2026-10-15. Status: accepted. Replaces the SMTP provider (Brevo) planned in [ADR-013](ADR-013-azure-infrastructure.md).

## Context

The API sends every email through an outbox (ADR-003, ADR-006): a request writes a row, the email leaves right after, failures are retried for about three days. Production was to use Brevo over SMTP with a login and an SMTP key in Key Vault. Brevo's account activation needs a phone verification that does not work for the owner, and a long-lived SMTP password is one more secret to protect and rotate.

## Decision

1. **Azure Communication Services Email** in production, created by Terraform (`infra/terraform/modules/email`): an Email Communication Service, an **Azure-managed domain** (`<guid>.azurecomm.net`, no DNS to manage), a Communication Service linked to it, both with **data location Europe**.
2. **No secret.** The API sends with its user-assigned managed identity (`DefaultAzureCredential`, `AZURE_CLIENT_ID`). That identity gets the built-in role _Communication and Email Service Owner_, **scoped to the Communication Service only**. It is broader than sending (it can manage that resource), but it is the only built-in role that allows sending, and custom roles are not reliably honoured by the email service. The SMTP placeholders are removed from Key Vault.
3. **Transport chosen by configuration**: `EMAIL_TRANSPORT=smtp` (Nodemailer, Mailpit locally, default) or `azure` (`@azure/communication-email`, `AZURE_COMMUNICATION_ENDPOINT`). The outbox, its retries, its encryption and the templates are unchanged; both transports implement the same `sendMail`. SMTP settings are needed only with `smtp`.
4. **Sender** `DoNotReply@<managed domain>` with the display name **"IconBridge Recruitment"**. `MAIL_FROM` is the bare address (refused otherwise with `azure`); the display name is a property of the sender in Azure. Azure creates `DoNotReply` itself with the managed domain, and the provider refuses to create a sender that already exists, so the display name is set once with `az` (a Terraform output prints the command).
5. **Accepted means sent.** The SDK checks the delivery status right after sending, and that check has its own small quota. The transport treats Azure's `202 Accepted` as success even if the status check then fails, so a throttled status check never makes the outbox send an email twice. Delivery is not followed further, as with an SMTP relay.
6. **Throttling is not failure.** An Azure-managed domain accepts **5 emails a minute and 10 an hour per subscription, and this cannot be raised**. On HTTP 429 the transport throws `MailThrottledError` with Azure's `Retry-After`; the outbox gives the attempt back, postpones that email, and the process sends nothing until the wait is over (the SDK's own retries are off so a send never sleeps for an hour). Tested in `email-throttling.e2e-spec.ts`.
7. **No tracking**: user engagement tracking is off on the domain and on each message.

## Consequences

- Cost: 0.00025 USD per email plus 0.00012 USD per MB. At the quota ceiling (about 7 200 emails a month) under 2 USD; at expected volumes a few cents.
- **Volume is the real limit.** Ten emails an hour is enough to verify accounts, reset passwords and notify applicants during the internship, but a job-alert batch with many subscribers leaves over several hours, and a busy day of registrations delays verification emails. Before real traffic: connect a verified custom domain (SPF and DKIM records), then ask Microsoft for a quota increase. That domain also stops emails from `azurecomm.net` landing in spam.
- One manual step after the first apply (the display name). Until it is done, emails show "DoNotReply".
- Locally nothing changes: Mailpit over SMTP. The production images against `docker-compose.prod.yml` also keep SMTP.
- The resource provider `Microsoft.Communication` had to be registered on the subscription (free); Terraform still never registers providers.
