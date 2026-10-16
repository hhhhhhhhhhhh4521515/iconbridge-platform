#!/usr/bin/env bash
# Smoke test of a deployment: the API and its database answer through the web app, and the
# home page renders. Retries for up to 5 minutes, the time of a cold start from zero.
#
#   smoke-test.sh https://site [force-failure]
#
# "force-failure" makes it fail after the checks, to exercise the automatic rollback.
set -euo pipefail
SITE=${1:?site URL}
FORCE=${2:-}
deadline=$((SECONDS + 300))

until body=$(curl -fsS --max-time 60 "$SITE/api/health/ready" 2>/dev/null) && [ "$body" = '{"status":"ok"}' ]; do
  if [ $SECONDS -ge $deadline ]; then
    echo "::error::$SITE/api/health/ready did not answer {\"status\":\"ok\"} within 5 minutes (last: ${body:-no answer})"
    exit 1
  fi
  sleep 5
done
echo "API and database: ok"

page=$(mktemp)
code=$(curl -sS --max-time 60 -o "$page" -w '%{http_code}' "$SITE/en")
if [ "$code" != 200 ] || ! grep -q '<title>' "$page"; then
  echo "::error::$SITE/en answered $code without a page"
  exit 1
fi
echo "Home page: ok ($(grep -o '<title>[^<]*' "$page" | head -1 | cut -c8-))"

if [ "$FORCE" = force-failure ]; then
  echo "::error::Smoke test failed on purpose (force_smoke_failure), to exercise the rollback"
  exit 1
fi
