#!/usr/bin/env bash
# Browser tests in WebKit, in the Playwright container (no system library to install).
#
#   pnpm test:browser:webkit [playwright arguments]
#
# Needs Docker, the compose services (`pnpm infra:up`), seeded data, and a build of
# the API and of the web app (`pnpm build`). Ports 3000 and 4000 of the host stay free
# or busy as they are: the container has its own.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./apps/web/node_modules/@playwright/test/package.json').version")
[ -f apps/api/dist/main.js ] || { echo "Build first: pnpm build" >&2; exit 1; }
[ -d apps/web/.next ] || { echo "Build first: pnpm build" >&2; exit 1; }
# host.docker.internal: Docker Desktop defines it; on Linux (CI runners) it is mapped here.
exec docker run --rm --init \
  --add-host=host.docker.internal:host-gateway \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/home \
  -e CI="${CI:-}" \
  -v "$PWD:$PWD" -w "$PWD" \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  node scripts/webkit-in-docker.mjs "$@"
