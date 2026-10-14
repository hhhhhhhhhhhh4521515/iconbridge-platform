# syntax=docker/dockerfile:1.7
# Web app of IconBridge Jobs (Next.js). Build from the repository root:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://jobs.example.com \
#     --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key> \
#     -t iconbridge-web .
#
# NEXT_PUBLIC_* values are written into the JavaScript sent to browsers, so they are
# fixed when the image is built: one image per public address. Everything else
# (API_INTERNAL_URL, CSP_MEDIA_ORIGINS, REVALIDATE_SECRET) is read when the server
# starts. See docs/DEPLOYMENT.md.

ARG NODE_IMAGE=node:22.23.3-alpine3.24
# Runtime: Alpine with its own Node 22 package and the full ICU data (see apps/api/Dockerfile).
ARG RUNTIME_IMAGE=alpine:3.22

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate && pnpm --version
WORKDIR /repo

# ---------------------------------------------------------------------------
FROM base AS prune
RUN npm install --global turbo@2.11.7
COPY . .
RUN turbo prune @iconbridge/web --docker

# ---------------------------------------------------------------------------
FROM base AS deps
COPY --from=prune /repo/out/json/pnpm-lock.yaml /repo/out/json/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile

# ---------------------------------------------------------------------------
FROM deps AS build
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Cloudflare's public test key by default: it accepts every visitor. Pass the real one.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} \
    NEXT_OUTPUT=standalone \
    # Checked by the build, not kept: the server reads its own value when it starts.
    # Pages ask the API at run time; the build does not need it to answer.
    API_INTERNAL_URL=http://api:4000
COPY --from=prune /repo/out/full/ ./
RUN pnpm turbo run build --filter=@iconbridge/web

# ---------------------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
ARG SOURCE_URL=https://github.com/hhhhhhhhhhhh4521515/iconbridge-platform
LABEL org.opencontainers.image.title="iconbridge-web" \
      org.opencontainers.image.description="IconBridge Jobs web app (Next.js)" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"
RUN apk add --no-cache "nodejs~22.23" "icu-data-full~76.1" \
    && addgroup -g 1000 node \
    && adduser -u 1000 -G node -s /sbin/nologin -D -H node
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # Idle connections are kept longer than the ingress and other clients keep theirs: a
    # request is never sent on a connection the server is closing (Node's default: 5 s).
    KEEP_ALIVE_TIMEOUT=65000
WORKDIR /app
# The standalone server with the files it needs, then what it serves as files:
# the built assets and the public folder.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER 1000:1000
EXPOSE 3000
# `node` is process 1 and stops cleanly on SIGTERM.
CMD ["node", "apps/web/server.js"]
