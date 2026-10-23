#!/usr/bin/env bash
# Restores a logical backup (pg_dump custom format) into a PostgreSQL database.
#
#   scripts/restore-backup.sh <file.dump | https://….blob.core.windows.net/backups/<name>> <target-database-url>
#
# A blob address is downloaded first with `az storage blob download --auth-mode login`
# (the person running it needs Storage Blob Data Reader). The target database must exist
# and should be empty: objects present in the dump are dropped and created again.
# pg_restore runs in the backup image (postgres 16 client), so nothing is installed here.
# docs/RUNBOOK.md, "Restore".
set -euo pipefail
SOURCE=${1:?dump file or blob URL}
TARGET=${2:?target database URL}
IMAGE=${BACKUP_IMAGE:-iconbridge-backup:local}
NETWORK=${DOCKER_NETWORK:-host}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if [[ "$SOURCE" == https://* ]]; then
  account=$(sed -E 's#https://([^.]+)\..*#\1#' <<<"$SOURCE")
  container=$(sed -E 's#https://[^/]+/([^/]+)/.*#\1#' <<<"$SOURCE")
  blob=${SOURCE#*/"$container"/}
  az storage blob download --auth-mode login --account-name "$account" \
    --container-name "$container" --name "$blob" --file "$work/backup.dump" --only-show-errors -o none
else
  cp "$SOURCE" "$work/backup.dump"
fi
chmod 644 "$work/backup.dump"

# --clean --if-exists: replaces what exists; --no-owner --no-acl: the target's own roles.
docker run --rm --network "$NETWORK" -v "$work:/restore:ro" --entrypoint pg_restore "$IMAGE" \
  --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$TARGET" /restore/backup.dump
echo "Restored $(basename "$SOURCE") into the target database."
