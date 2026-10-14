# ADR-012: Container images

Date: 2026-10-14. Status: accepted.

## Context

The API and the web app run in Azure Container Apps, and the database is migrated by a Container Apps Job before each deployment. The images had to be small (API under 250 MB, web under 200 MB), run as non-root, contain only production code, and pass trivy without a fixable high or critical vulnerability. The repository is a pnpm workspace built with Turborepo.

## Decisions

1. **Prune, fetch, install offline.** `turbo prune --docker` reduces the workspace to one app; `pnpm fetch` downloads from the lockfile alone, so the dependency layer is cached until the lockfile changes.
2. **Runtime base: `alpine:3.22` with Alpine's Node 22 package**, not `node:22-alpine`. The official image is 170 MB, mostly a Node binary with its own ICU and npm/yarn that a later layer cannot remove. Alpine's Node 22 with `icu-data-full` is 106 MB and keeps French and Arabic date formatting. Node and ICU are then updated by Alpine's security releases, pinned to `nodejs~22.23` and `icu-data-full~76.1`. The build stages keep `node:22-alpine`, which has corepack. Distroless was set aside: it is Debian (glibc), so the native modules (argon2, sharp) would need a second build environment.
3. **Only the files the API loads.** `pnpm deploy --prod` still gave 721 MB of `node_modules`: the Prisma CLI, its studio and their dependencies arrive as peers of the Prisma client, and packages ship code for every platform and database. `@vercel/nft`, the tracer behind the Next.js standalone output, follows the imports of `dist/main.js` and `dist/cli.js` and keeps 75 MB. Files loaded by name (pino's worker, swagger-ui's assets) are listed explicitly. The risk, a file the tracer misses, is covered by running the whole browser suite against the production images.
4. **A separate, small migration image** rather than the build stage: the build stage weighs 3.4 GB and carries npm and the development tools, which trivy flags. The seed is compiled to JavaScript and the Prisma CLI is traced like the API. Sample data needs Faker and is loaded only in development, so it is not in the image and cannot be written in production.
5. **Next.js standalone output, opt-in** (`NEXT_OUTPUT=standalone` in the Dockerfile), so `next start` keeps working for local tests. `NEXT_PUBLIC_*` values are build arguments: one web image per public address.
6. **The sitemap is rendered on request.** Built with the image, it was generated while the API was out of reach and listed no job until its first refresh. It now reads the cached job list when asked for.
7. **Local run with the production images** through `docker-compose.prod.yml`, which includes the development services. Azurite gets the alias `azurite.localhost`: the API signs download links with it and browsers send every `*.localhost` name to the machine, so the same link works in the container and in the browser. The API container uses `NODE_ENV=test` there, because `production` refuses the Turnstile test keys and SMTP without TLS.

## Consequences

- A new dependency of the API needs no Dockerfile change, unless it loads a file by a name built at run time; then it goes in the `--keep` list of the trace, and the browser suite against the images shows it.
- `docker images` on Docker Desktop with the containerd store shows sizes above the real ones (it adds the compressed layers); sizes are measured from the layers.
- The images are rebuilt when Alpine publishes a Node or ICU security update; the pinned prefixes let `apk` take patch releases.
