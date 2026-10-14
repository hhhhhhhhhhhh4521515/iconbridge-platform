# Deployment

How the three container images of IconBridge Jobs are built, checked and run: on this machine with `docker-compose.prod.yml`, then in Azure Container Apps. The Azure resources themselves (Terraform) and the CI/CD pipeline are not written yet; this document gives what they need.

## Images

| Image                | Dockerfile (target)             | Runs                                                      | Size (uncompressed / to pull) |
| -------------------- | ------------------------------- | --------------------------------------------------------- | ----------------------------- |
| `iconbridge-api`     | `apps/api/Dockerfile`           | The API, port 4000 (`node dist/main.js`)                  | 203 MB / 66 MB                |
| `iconbridge-migrate` | `apps/api/Dockerfile` `migrate` | `prisma migrate deploy`, then the seed of reference data  | 259 MB / 90 MB                |
| `iconbridge-web`     | `apps/web/Dockerfile`           | The Next.js server, port 3000 (`node apps/web/server.js`) | 166 MB / 63 MB                |

The scheduled tasks use the API image with another command: `node dist/cli.js all`.

All three:

- run as user 1000 (`node`), never root, with `node` as process 1 so it receives SIGTERM;
- start from `alpine:3.22` with Alpine's Node 22 package and the full ICU data (dates in French and Arabic); no npm, yarn or pnpm in the final image;
- carry the labels `org.opencontainers.image.source`, `revision` and `created` (build arguments `VCS_REF` and `BUILD_DATE`).

Sizes are measured from the image layers. Docker Desktop with the containerd image store shows larger numbers in `docker images` (about 290, 360 and 235 MB), because it adds the compressed copy of each layer to the unpacked one.

### How they are built

```mermaid
flowchart LR
  P["prune<br/>turbo prune --docker"] --> D["deps<br/>pnpm fetch, install --offline"]
  D --> B["build<br/>turbo run build"]
  B -- "pnpm deploy --prod<br/>+ file trace" --> R["runtime (api)"]
  B -- "seed compiled, Prisma CLI<br/>+ file trace" --> M["migrate"]
  B -- "Next.js standalone" --> W["runtime (web)"]
```

1. **prune**: `turbo prune <app> --docker` keeps the app, the workspace packages it uses, and a lockfile reduced to them.
2. **deps**: `pnpm fetch` needs only the lockfile, so this layer is rebuilt only when dependencies change; then `pnpm install --offline --frozen-lockfile`.
3. **build**: `turbo run build` builds `packages/shared`, generates the Prisma client and compiles the app.
4. **API runtime**: `pnpm deploy --prod` gives the production dependencies in a flat folder; `apps/api/scripts/trace-runtime.mjs` then keeps only the files that `dist/main.js` and `dist/cli.js` load (with `@vercel/nft`, the tracer of Next.js). This takes `node_modules` from 721 MB to 75 MB: the Prisma CLI and its studio arrive as peers of the client, and many packages ship code for every platform.
5. **migrate**: the seed is compiled to JavaScript (`tsconfig.seed.json`); the trace keeps it, the Prisma CLI and its engines. The sample data (Faker) is not in it.
6. **web**: `NEXT_OUTPUT=standalone` makes Next.js write a server with only the files it needs; the static assets and `public/` are copied next to it.

Prisma 7 with the PostgreSQL driver adapter has no native query engine: the client is TypeScript compiled into `dist/`, so there is no binary target to choose for Alpine. The migration image carries the schema engine of the Prisma CLI for `linux-musl`.

## Build

From the repository root:

```bash
REF=$(git rev-parse --short HEAD)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

docker build -f apps/api/Dockerfile -t iconbridge-api:$REF \
  --build-arg VCS_REF=$REF --build-arg BUILD_DATE=$NOW .

docker build -f apps/api/Dockerfile --target migrate -t iconbridge-migrate:$REF \
  --build-arg VCS_REF=$REF --build-arg BUILD_DATE=$NOW .

docker build -f apps/web/Dockerfile -t iconbridge-web:$REF \
  --build-arg VCS_REF=$REF --build-arg BUILD_DATE=$NOW \
  --build-arg NEXT_PUBLIC_SITE_URL=https://jobs.example.com \
  --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key> .
```

`NEXT_PUBLIC_*` values are written into the JavaScript sent to browsers, so they are fixed when the web image is built: build one web image per public address (staging, production). Everything else is read when the containers start.

## Check

```bash
# Dockerfiles
docker run --rm -i hadolint/hadolint < apps/api/Dockerfile
docker run --rm -i hadolint/hadolint < apps/web/Dockerfile

# Images: fail on a HIGH or CRITICAL vulnerability that has a fix
for image in iconbridge-api iconbridge-migrate iconbridge-web; do
  trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 $image:$REF
done
```

Results on 14 October 2026: hadolint without remark on both files; trivy found no fixable high or critical vulnerability in the three images.

## Run the production images on this machine

`docker-compose.prod.yml` runs the three images against the local PostgreSQL, Azurite and Mailpit, with the same data as `pnpm dev`:

```bash
# pnpm dev uses ports 3000 and 4000: stop it first.
docker compose -f docker-compose.prod.yml up --build
```

| Step         | What happens                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------- |
| 1. Services  | PostgreSQL, Azurite and Mailpit of `docker-compose.yml` start (or are already running)          |
| 2. `migrate` | Applies the migrations, creates reference data and the first super admin if missing, then exits |
| 3. `api`     | Starts when `migrate` succeeded; healthy when `/health/ready` answers                           |
| 4. `web`     | Starts when the API is healthy                                                                  |

Then: the site on <http://localhost:3000>, the API docs on <http://localhost:4000/api/docs>, the emails in Mailpit on <http://localhost:8025>.

Secrets come from the local `apps/api/.env` and `apps/web/.env` (`pnpm env:init`); the compose file only changes what differs inside Docker (host names, ports). Differences with production, all on purpose:

- `NODE_ENV=test` for the API container: `production` refuses the Turnstile test keys and SMTP without TLS (Mailpit). Everything else behaves as in production.
- Azurite is reached as `azurite.localhost`: the API signs download links with that name, and browsers send every `*.localhost` name to this machine. Chromium, Firefox and Edge do; Safari does not.
- The scheduled tasks do not run by themselves (`SCHEDULER_ENABLED=false`, as in Azure). Run them like the Azure job does:

  ```bash
  docker compose -f docker-compose.prod.yml run --rm --no-deps api node dist/cli.js all
  ```

- The browser tests can run against these containers. Rate limits must be off, because every test signs in from this machine:

  ```bash
  RATE_LIMITS_ENABLED=false docker compose -f docker-compose.prod.yml up -d --build --wait
  pnpm test:browser
  ```

Stop with `docker compose -f docker-compose.prod.yml down` (the volumes, and so the data, stay).

## Azure Container Apps

Region, quotas, budget and the identity of the pipeline are in [00-environment.md](00-environment.md).

### Order of a deployment

1. Build, scan and push the three images to Azure Container Registry, tagged with the git commit.
2. Start the Container Apps Job `migrate` with the new image tag and wait for it to succeed. Migrations must stay backward compatible with the running API (add columns, then remove them in a later release), because the old revision serves traffic until step 3 ends.
3. Update the API, then the web app, to the new tag. Container Apps starts the new revision, waits for its readiness probe, then moves the traffic and stops the old one (SIGTERM).
4. Update the scheduled job to the new API tag.

### Container Apps

| Setting           | API                                            | Web                                    |
| ----------------- | ---------------------------------------------- | -------------------------------------- |
| Image             | `iconbridge-api:<commit>`                      | `iconbridge-web:<commit>`              |
| Ingress           | Internal only, target port 4000                | External, HTTPS only, target port 3000 |
| Liveness probe    | HTTP `GET /health/live`                        | HTTP `GET /en`                         |
| Readiness probe   | HTTP `GET /health/ready` (checks the database) | HTTP `GET /en`                         |
| Startup probe     | `GET /health/live`, up to 60 s                 | `GET /en`, up to 60 s                  |
| Scale             | 0 to 3 replicas, HTTP rule                     | 0 to 3 replicas, HTTP rule             |
| Termination grace | 30 s (longer than the emails in progress)      | 30 s                                   |
| Identity          | Managed identity: Blob Storage, Key Vault      | —                                      |

The browser never calls the API host: the web app forwards `/api/v1/*` to `API_INTERNAL_URL`, the internal address of the API app.

### Container Apps Jobs

| Job       | Image                         | Trigger                                        | Command                      |
| --------- | ----------------------------- | ---------------------------------------------- | ---------------------------- |
| `migrate` | `iconbridge-migrate:<commit>` | Manual, by the pipeline before each deployment | default (`CMD` of the image) |
| `tasks`   | `iconbridge-api:<commit>`     | Schedule `*/15 * * * *`                        | `node dist/cli.js all`       |

The task job sends the emails the API could not send at once, closes expired jobs, sends job alerts and applies the retention rules. Each task takes a PostgreSQL advisory lock, so two runs never overlap. Emails do not wait for this job: the API sends each one right after its database transaction, and the job only retries those that failed (`apps/api/test/e2e/email-immediate.e2e-spec.ts`).

### Configuration

Secrets are Key Vault references in Container Apps, never plain values in the template.

**API** (`apps/api/.env.example` documents each variable):

| Variable                                                            | Production value                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                          | `production` (set in the image)                                                                       |
| `PORT`                                                              | `4000` (set in the image)                                                                             |
| `WEB_ORIGIN`                                                        | Public address of the site, e.g. `https://jobs.example.com`                                           |
| `WEB_INTERNAL_URL`                                                  | Internal address of the web app, for cache invalidation                                               |
| `DATABASE_URL`                                                      | Secret. PostgreSQL Flexible Server, `sslmode=require`                                                 |
| `AZURE_STORAGE_ACCOUNT_URL`                                         | `https://<account>.blob.core.windows.net` (managed identity); `AZURE_STORAGE_CONNECTION_STRING` empty |
| `PUBLIC_MEDIA_BASE_URL`                                             | Public URL of the `public-media` container (or the CDN in front of it)                                |
| `PASSPORT_ENCRYPTION_KEY`                                           | Secret. 32 bytes, base64. Losing it makes every stored passport number unreadable                     |
| `JWT_ACCESS_SECRET`                                                 | Secret, at least 32 characters                                                                        |
| `REVALIDATE_SECRET`                                                 | Secret, the same value in the web app                                                                 |
| `TURNSTILE_SECRET_KEY`                                              | Secret. The real key (test keys are refused in production)                                            |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | The mail provider, port 587, STARTTLS (required in production)                                        |
| `TRUST_PROXY_HOPS`                                                  | The proxies in front of the API (see below)                                                           |
| `SCHEDULER_ENABLED`                                                 | `false`: the `tasks` job runs the tasks                                                               |
| `MAIL_DELIVERY`                                                     | `background` (default)                                                                                |

**Migration job**: `DATABASE_URL`, `PASSPORT_ENCRYPTION_KEY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (secret; used only when no super admin exists yet). `NODE_ENV=production` is set in the image, so no sample data is ever written.

**Web**: `API_INTERNAL_URL` (internal address of the API), `CSP_MEDIA_ORIGINS` (`https://<account>.blob.core.windows.net`, plus the CDN if any), `REVALIDATE_SECRET` (secret). The `NEXT_PUBLIC_*` values are build arguments (see [Build](#build)).

`TRUST_PROXY_HOPS` must equal the number of proxies that add themselves to `X-Forwarded-For` between the visitor and the API (the external ingress, the web app, the internal ingress of the API). Too low, and every visitor shares the address of a proxy for the rate limits; too high, and a visitor can choose their own address. Check it on the first deployment: sign in once and read the address in the audit log, which must be yours.

### Shutdown

Container Apps sends SIGTERM to process 1, then SIGKILL after the grace period.

- **API**: stops accepting requests, finishes those in progress and the emails being sent, closes the SMTP and database connections, exits with 0. Measured locally: 0.6 s.
- **Web**: Next.js stops accepting requests, waits for those in progress, then exits with 143 (128 + SIGTERM), on purpose.

## Troubleshooting

| Symptom                                                                      | Cause and fix                                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The API exits at start with "Invalid environment configuration"              | The listed variables are missing or malformed (their values are never printed)   |
| `migrate` fails with "Cannot seed: missing or invalid …"                     | The listed seed variables are missing                                            |
| Pictures do not show, the browser console names the CSP                      | `CSP_MEDIA_ORIGINS` of the web app does not list the storage address             |
| The public site shows changes a minute late                                  | `WEB_INTERNAL_URL` or `REVALIDATE_SECRET` differ between the API and the web app |
| Every visitor is rate-limited together                                       | `TRUST_PROXY_HOPS` is too low                                                    |
| Locally, `docker compose -f docker-compose.prod.yml up` says a port is taken | `pnpm dev` is still running                                                      |
