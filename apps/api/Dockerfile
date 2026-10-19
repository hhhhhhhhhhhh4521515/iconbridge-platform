# syntax=docker/dockerfile:1.7
# API of IconBridge Jobs. Build from the repository root:
#
#   docker build -f apps/api/Dockerfile -t iconbridge-api .
#   docker build -f apps/api/Dockerfile --target migrate -t iconbridge-migrate .
#
# Stages: prune (only what the API needs from the monorepo) -> deps (pnpm fetch, then an
# offline install) -> build -> migrate (the job that runs before each deployment) ->
# runtime (the API; the last stage, so the default target). See docs/DEPLOYMENT.md.

ARG NODE_IMAGE=node:22.23.3-alpine3.24
# Runtime: Alpine with its own Node 22 package (security fixes through apk). The official
# node image weighs 170 MB, mostly a Node binary and npm/yarn that a lower layer cannot
# drop; this base is 106 MB with the full ICU data, which French and Arabic dates need.
ARG RUNTIME_IMAGE=alpine:3.22

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    # The git hooks of the repository have no use in an image.
    HUSKY=0 \
    CI=true
# The version of the `packageManager` field of package.json.
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate && pnpm --version
WORKDIR /repo

# ---------------------------------------------------------------------------
# The API, the packages it depends on, and a lockfile reduced to them.
FROM base AS prune
RUN npm install --global turbo@2.11.7
COPY . .
RUN turbo prune @iconbridge/api --docker

# ---------------------------------------------------------------------------
# Dependencies. This layer changes only with the lockfile: `pnpm fetch` needs nothing else.
FROM base AS deps
COPY --from=prune /repo/out/json/pnpm-lock.yaml /repo/out/json/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile

# ---------------------------------------------------------------------------
FROM deps AS build
COPY --from=prune /repo/out/full/ ./
# Builds packages/shared, generates the Prisma client, then compiles the API.
RUN pnpm turbo run build --filter=@iconbridge/api
# The API with its production dependencies only, in one self-contained directory.
# A flat node_modules (no symlinks), then only the files the API loads (see the script).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @iconbridge/api deploy --prod --legacy --config.node-linker=hoisted /deployed \
    && cp -r apps/api/dist /deployed/dist \
    && node apps/api/scripts/trace-runtime.mjs /deployed /out dist/main.js dist/cli.js \
      # pino starts its worker from a file name; the API docs serve the files of swagger-ui.
      --keep node_modules/pino/lib/worker.js --keep node_modules/pino/file.js \
      --keep node_modules/thread-stream/lib/worker.js --keep node_modules/swagger-ui-dist \
    && cp /deployed/package.json /out/
# The migration job: the Prisma CLI, the migrations, and the seed compiled to JavaScript,
# taken from an install that includes the development dependencies (Prisma CLI is one).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @iconbridge/api exec tsc -p tsconfig.seed.json \
    && pnpm --filter @iconbridge/api deploy --legacy --config.node-linker=hoisted /deployed-dev \
    && cp -r apps/api/dist-seed /deployed-dev/dist-seed \
    && node apps/api/scripts/trace-runtime.mjs /deployed-dev /migrate \
      dist-seed/prisma/seed.js node_modules/prisma/build/index.js \
      # Loaded by the Prisma CLI from its own paths: the engines and its configuration loader.
      --keep node_modules/prisma --keep node_modules/@prisma/engines \
      --keep node_modules/dotenv \
    && cp -r /deployed-dev/prisma /deployed-dev/prisma.config.ts /deployed-dev/package.json /migrate/

# ---------------------------------------------------------------------------
# Runs before each deployment, as an Azure Container Apps Job: applies the migrations,
# then creates the reference data (destinations, categories, settings) and the first
# super admin if they are missing. Sample data is for NODE_ENV=development only and is
# not in this image.
#
#   docker build -f apps/api/Dockerfile --target migrate -t iconbridge-migrate .
FROM ${RUNTIME_IMAGE} AS migrate
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
ARG SOURCE_URL=https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform
LABEL org.opencontainers.image.title="iconbridge-migrate" \
      org.opencontainers.image.description="IconBridge Jobs database migrations and reference data" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"
RUN apk add --no-cache "nodejs~22.23" "icu-data-full~76.1" \
    && addgroup -g 1000 node \
    && adduser -u 1000 -G node -s /sbin/nologin -D -H node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /migrate/ ./
USER 1000:1000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist-seed/prisma/seed.js"]

# ---------------------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
ARG SOURCE_URL=https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform
LABEL org.opencontainers.image.title="iconbridge-api" \
      org.opencontainers.image.description="IconBridge Jobs API (NestJS)" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"
# Node 22 and the full ICU data only: no package manager in the image. The user `node`
# (uid 1000) runs the API.
RUN apk add --no-cache "nodejs~22.23" "icu-data-full~76.1" \
    && addgroup -g 1000 node \
    && adduser -u 1000 -G node -s /sbin/nologin -D -H node
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER 1000:1000
EXPOSE 4000
# Liveness: GET /health/live. Readiness (database reachable): GET /health/ready.
# No HEALTHCHECK: Container Apps probes these two addresses.
# `node` is process 1 and receives SIGTERM itself: the API finishes the requests and the
# emails in progress, then exits.
# The commit, shown by /health/live and /health/ready: the deployment waits for it. Last,
# so a new commit does not invalidate the layers above.
ENV APP_VERSION=${VCS_REF}
CMD ["node", "dist/main.js"]
