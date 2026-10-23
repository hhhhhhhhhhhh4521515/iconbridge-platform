# syntax=docker/dockerfile:1
# Weekly logical backup of the database (Container Apps Job caj-iconbridge-backup-…):
# pg_dump of PostgreSQL 16, uploaded with curl and the managed identity to the private
# `backups` container. docs/RUNBOOK.md, ADR-020.
#
# Alpine packages only: no Go binary (azcopy) whose embedded standard library would need
# a new release for every Go security fix.
FROM alpine:3.22
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="iconbridge-backup" \
      org.opencontainers.image.description="Weekly pg_dump of IconBridge Jobs to Azure Blob Storage" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"
# pg_dump of the server's major version (16); curl and jq for the token and the upload;
# ca-certificates for TLS to PostgreSQL and Azure.
RUN apk add --no-cache "postgresql16-client~16" "curl~8" "jq~1" "ca-certificates>=20260909" \
    && addgroup -g 1000 backup \
    && adduser -u 1000 -G backup -s /sbin/nologin -D backup
COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh
USER 1000:1000
WORKDIR /tmp
ENV APP_VERSION=${VCS_REF}
# A job that runs to completion: nothing to probe, its exit code is the result.
HEALTHCHECK NONE
ENTRYPOINT ["/usr/local/bin/backup.sh"]
