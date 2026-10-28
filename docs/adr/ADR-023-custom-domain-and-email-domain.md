# ADR-023: The site and its emails on iconbridgerecruitment.com

Date: 2026-10-28. Status: accepted.

## Context

The site answered on the default Azure address (`ca-iconbridge-web-prod-itn.….azurecontainerapps.io`) and sent email from `DoNotReply@<guid>.azurecomm.net`, limited to 10 emails an hour for the subscription (ADR-014). The owner bought `iconbridgerecruitment.com`; its DNS is at Cloudflare.

Constraints:

- Container Apps issue free managed certificates, but the azurerm provider cannot bind them (one `az containerapp hostname bind` per name, ADR-013).
- An apex domain cannot be a CNAME in standard DNS: it gets an A record to the environment's static IP, and its certificate is validated over HTTP; a subdomain such as `www` gets a CNAME and CNAME validation.
- Container Apps ingress has no redirect rules.
- The web image bakes `NEXT_PUBLIC_SITE_URL` at build time (sitemap, robots, canonical links), while `WEB_ORIGIN` of the API, the storage CORS rule and the availability tests are set by Terraform: the two change at different moments.
- Azure refuses to link an email domain to the Communication Service before it is verified.

## Decision

1. **One address**: `https://iconbridgerecruitment.com`. `www.iconbridgerecruitment.com` and the default Azure address stay bound to the web app, and the web app's proxy redirects their pages there with a 308, path and query kept (`canonicalRedirectUrl`). `/api/v1/*` and the health endpoints are not redirected: a page opened before the switch keeps working, and a revision can still be checked at its Azure address. Nothing is redirected while the site itself is not on HTTPS (local, tests).
2. **`WEB_ORIGIN_ALIASES`** (API, optional, comma-separated): extra origins accepted by the CSRF origin check and CORS; links always use `WEB_ORIGIN`. Terraform sets it to the default Azure address once the domain is enabled, and adds it to the storage CORS rule, so the moment between the apply and the new web image breaks nothing.
3. **Terraform** (`custom_domain`, `custom_domain_aliases`, `email_domain`, `enable_custom_domain`, `use_email_domain`) gives every DNS record in one output (`dns_records`) as soon as the names are set, before anything depends on them; the switches are turned on once the records resolve and the email domain is verified.
4. **Cloudflare records are "DNS only"**: Azure validates and renews the certificates itself, and a Cloudflare proxy would hide the origin and add a hop to `X-Forwarded-For`.
5. **Email** from `noreply@iconbridgerecruitment.com`, display name "IconBridge Recruitment", the sender created by Terraform. The Azure-managed domain stays linked, so going back is a change of `MAIL_FROM`. `EMAIL_HOURLY_QUOTA` follows the domain: 10 for the Azure-managed one, 100 (Azure's starting limit) for the custom one, overridden by `email_hourly_quota` after a raise.
6. **Public settings of production** live in the committed `production.auto.tfvars`, read after the `TF_VARS_PROD` secret: the domain and the switches change through pull requests (ADR-022 introduced the file).

## Consequences

- The switch takes three applies and one deployment: names (records appear), domain enabled with the bindings, `SITE_URL` changed and the web image rebuilt; then the email switch after verification.
- Sessions are host cookies: people signed in on the old address sign in once more.
- Certificates renew automatically only while the records stay as they are (A to the static IP, CNAME to the web app) and unproxied.
- The SPF record is Azure's (`include:spf.protection.outlook.com`); another mail service for the domain would have to share that one record.
- A higher email limit needs a support request with Azure, granted on the domain's sending record (DEPLOYMENT, "Email on the site's domain").
