#!/usr/bin/env bash
# Azurite with the options of docker-compose.yml (a service container cannot take a
# command), published on port 10000, and waits until it accepts connections.
set -euo pipefail
docker run -d --name azurite -p 10000:10000 mcr.microsoft.com/azure-storage/azurite:latest \
  azurite-blob --blobHost 0.0.0.0 --blobPort 10000 --location /data --skipApiVersionCheck --disableProductStyleUrl >/dev/null
for _ in $(seq 1 30); do
  if (exec 3<>/dev/tcp/127.0.0.1/10000) 2>/dev/null; then exit 0; fi
  sleep 1
done
echo "Azurite did not start" >&2
docker logs azurite >&2
exit 1
