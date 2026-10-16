#!/usr/bin/env bash
# Measures a cold start of production: waits until the web app and the API both run no
# replica, requests the home page, then prints the timeline of the start from Log
# Analytics (scaling, image pull, container start, app ready, probes, first requests),
# in seconds after the request.
#
#   bash scripts/measure-cold-start.sh            # waits up to 30 min for scale to zero
#
# Needs `az login` and .azure-context. Reads only; changes nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.azure-context; set +a

RG=rg-iconbridge-prod
WEB=ca-iconbridge-web-prod-itn
API=ca-iconbridge-api-prod-itn
SITE="https://$(az containerapp show -g $RG -n $WEB --query properties.configuration.ingress.fqdn -o tsv)"
WS=$(az monitor log-analytics workspace show -g $RG -n log-iconbridge-prod-itn --query customerId -o tsv)
replicas() { az containerapp replica list -g $RG -n "$1" --query 'length(@)' -o tsv 2>/dev/null || echo '?'; }

for i in $(seq 1 60); do
  web=$(replicas $WEB); api=$(replicas $API)
  [ "$web" = 0 ] && [ "$api" = 0 ] && break
  [ "$i" = 60 ] && { echo "Still running after 30 min (web=$web api=$api)" >&2; exit 1; }
  sleep 30
done

T0=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
echo "Request at $T0 (both apps at zero)"
curl -s -o /dev/null --max-time 180 -w "GET /en -> %{http_code} in %{time_total} s\n" "$SITE/en"
curl -s -o /dev/null --max-time 60 -w "GET /en (warm) -> %{http_code} in %{time_total} s\n" "$SITE/en"

echo "Waiting 3 min for the logs to reach Log Analytics..."
sleep 180
az monitor log-analytics query -w "$WS" -o tsv --analytics-query "
let t0 = datetime($T0);
let sys = ContainerAppSystemLogs_CL
  | where TimeGenerated between (t0 - 5s .. t0 + 4m) and ContainerAppName_s in ('$WEB', '$API')
  | where Log_s has_any ('Scaled', 'scheduled', 'Pulling', 'pulled', 'Container started', 'probe failed', 'Key Vault')
  | project at = TimeGenerated, app = ContainerAppName_s, event = substring(Log_s, 0, 110);
let con = ContainerAppConsoleLogs_CL
  | where TimeGenerated between (t0 - 5s .. t0 + 4m) and ContainerAppName_s in ('$WEB', '$API')
  | extend ms = tolong(extract('\"time\":([0-9]{13})', 1, Log_s))
  | extend at = iff(isnull(ms), TimeGenerated, unixtime_milliseconds_todatetime(ms))
  | where Log_s has_any ('Ready in', 'successfully started', 'API on', '\"req\"')
  | summarize at = min(at) by app = ContainerAppName_s, event = case(Log_s has 'Ready in', 'Next.js ready', Log_s has '\"req\"', 'first request served', 'Nest ready');
union sys, con
| extend s = round(datetime_diff('millisecond', at, t0) / 1000.0, 1)
| project s, app = replace_string(replace_string(app, 'ca-iconbridge-', ''), '-prod-itn', ''), event
| order by s asc" | cut -f2- | column -t -s $'\t'
