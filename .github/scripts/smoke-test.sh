#!/usr/bin/env bash
# Smoke test of a deployment, through the public address of the web app:
# - /api/health/ready answers "ok": the API and its database work;
# - with an expected commit, the web app and the API both report it (APP_VERSION), so the
#   answer comes from the new revisions, not from the old ones still holding the traffic;
# - the home page renders (its title is printed: it shows which version answered).
# Retries for up to 5 minutes, the time of a cold start from zero.
#
#   smoke-test.sh https://site [expected-commit] [force-failure]
#
# Images built before 19 October 2026 report no version: for them the check relies on the
# revision being ready (deploy.yml) and says so. "force-failure" makes it fail after the
# checks, to exercise the automatic rollback.
set -euo pipefail
SITE=${1:?site URL}
EXPECTED=${2:-}
FORCE=${3:-}
deadline=$((SECONDS + 300))
last='no answer'

while :; do
  # The web app waits up to 70 s for an API starting from zero.
  if body=$(curl -fsS --max-time 90 "$SITE/api/health/ready" 2>/dev/null); then
    last=$body
    status=$(jq -r '.status // empty' <<<"$body" 2>/dev/null || true)
    web=$(jq -r '.version // empty' <<<"$body" 2>/dev/null || true)
    api=$(jq -r '.api // empty' <<<"$body" 2>/dev/null || true)
    if [ "$status" = ok ]; then
      if [ -z "$EXPECTED" ]; then
        break
      elif [ -z "$web" ]; then
        echo "::warning::This image reports no version (built before 19 October 2026): checked by revision readiness only"
        break
      elif [ "$web" = "$EXPECTED" ] && [ "$api" = "$EXPECTED" ]; then
        break
      fi
    fi
  fi
  if [ $SECONDS -ge $deadline ]; then
    echo "::error::$SITE/api/health/ready did not report status ok${EXPECTED:+ and version $EXPECTED} within 5 minutes (last: $last)"
    exit 1
  fi
  sleep 5
done
echo "API and database: ok${web:+ (web ${web:0:12}, API ${api:0:12})}"

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
