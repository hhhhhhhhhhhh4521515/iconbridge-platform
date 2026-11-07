#!/bin/sh
# Logical backup of the database to Blob Storage. Settings (Container Apps Job):
#   DATABASE_URL           postgresql://…?sslmode=require&schema=public (Key Vault)
#   BACKUP_CONTAINER_URL   https://<account>.blob.core.windows.net/backups
#   AZURE_CLIENT_ID        the user-assigned managed identity (Storage Blob Data Contributor)
#   DATABASE_AUTH          entra: DATABASE_URL names the identity, without password; pg_dump
#                          signs in with a Microsoft Entra token of the identity (PGPASSWORD)
# Container Apps sets IDENTITY_ENDPOINT and IDENTITY_HEADER for the managed identity.
# Prints one JSON line with the result; exits non-zero on any failure, so Container Apps
# marks the execution failed and the backup alert fires.
set -eu

: "${DATABASE_URL:?}" "${BACKUP_CONTAINER_URL:?}" "${IDENTITY_ENDPOINT:?}" "${IDENTITY_HEADER:?}"
started=$(date -u +%s)
name="iconbridge-$(date -u +%Y%m%dT%H%M%SZ).dump"
file="/tmp/$name"
trap 'rm -f "$file"' EXIT

# libpq refuses Prisma's `schema` parameter: keep the address and TLS only (PGSSLMODE
# overrides require for a local database without TLS).
url="${DATABASE_URL%%\?*}?sslmode=${PGSSLMODE:-require}"

# Tokens of the managed identity (no account key, no SAS, no database password).
identity_token() {
  curl --fail --silent --show-error \
    -H "X-IDENTITY-HEADER: $IDENTITY_HEADER" \
    "$IDENTITY_ENDPOINT?api-version=2019-08-01&resource=$1${AZURE_CLIENT_ID:+&client_id=$AZURE_CLIENT_ID}" |
    jq -er .access_token
}

if [ "${DATABASE_AUTH:-password}" = entra ]; then
  PGPASSWORD=$(identity_token "https%3A%2F%2Fossrdbms-aad.database.windows.net")
  export PGPASSWORD
fi

# Custom format: compressed, restorable table by table with pg_restore.
pg_dump --format=custom --compress=6 --no-owner --no-acl --dbname="$url" --file="$file"
size=$(wc -c <"$file" | tr -d ' ')
md5=$(md5sum "$file" | cut -c1-32 | xxd -r -p | base64)

token=$(identity_token "https%3A%2F%2Fstorage.azure.com%2F")

# One Put Blob (up to 5000 MiB); the service checks Content-MD5 against what it received.
curl --fail --silent --show-error --retry 3 --upload-file "$file" \
  -H "Authorization: Bearer $token" \
  -H "x-ms-version: 2023-11-03" \
  -H "x-ms-blob-type: BlockBlob" \
  -H "Content-Type: application/octet-stream" \
  -H "Content-MD5: $md5" \
  -o /dev/null \
  "${BACKUP_CONTAINER_URL%/}/$name"

printf '{"backup":"%s","bytes":%s,"seconds":%s,"ok":true}\n' "$name" "$size" "$(( $(date -u +%s) - started ))"
