#!/usr/bin/env bash
# Waits until each Container App serves the revision just created: it is the latest
# ready revision (single revision mode then moves all the traffic to it), running and
# healthy. Fails after 6 minutes, which makes deploy.yml roll back. A failed az call
# (Azure Resource Manager answers 503 now and then) counts as "not ready yet" and is
# retried until the deadline.
#
#   wait-revisions.sh app=revision [app=revision...]     (RESOURCE_GROUP in the environment)
set -euo pipefail
: "${RESOURCE_GROUP:?}"
deadline=$((SECONDS + 360))
for pair in "$@"; do
  app=${pair%%=*}
  revision=${pair#*=}
  while :; do
    ready=$(az containerapp show -g "$RESOURCE_GROUP" -n "$app" --query properties.latestReadyRevisionName -o tsv --only-show-errors) || ready="(az call failed)"
    state=$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$app" --revision "$revision" --query "[properties.runningState, properties.healthState]" -o tsv --only-show-errors | tr '\n' ' ') || state="(az call failed)"
    if [ "$ready" = "$revision" ] && [[ "$state" != *Failed* ]] && [[ "$state" != *Unhealthy* ]]; then
      echo "$app: $revision is ready ($state)"
      break
    fi
    if [ $SECONDS -ge $deadline ]; then
      echo "::error::$app: revision $revision not ready after 6 minutes (latest ready: $ready; state: $state)"
      exit 1
    fi
    sleep 10
  done
done
