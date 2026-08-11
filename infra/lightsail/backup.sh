#!/bin/sh
set -eu

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
cadence="${1:-daily}"
case "$cadence" in daily|weekly) ;; *) echo "usage: backup.sh [daily|weekly]" >&2; exit 2 ;; esac
archive="/tmp/opensidebar-${timestamp}.dump"
encrypted="${archive}.age"
trap 'rm -f "$archive" "$encrypted"' EXIT

if [ -n "${PLAYGROUND_POSTGRES_CONTAINER:-}" ]; then
  # The shared database contains mutually isolated playground and control
  # schemas. Back up through the container-local postgres peer identity so the
  # encrypted archive includes both without granting either app role access to
  # the other schema.
  docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" pg_dump \
    --username postgres --dbname "${PLAYGROUND_DB_NAME:-opensidebar}" --format=custom > "$archive"
  docker exec -i -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" pg_restore \
    --list < "$archive" > /dev/null
else
  docker compose exec -T postgres pg_dump \
    --username opensidebar_owner --dbname opensidebar --format=custom > "$archive"
  docker compose exec -T postgres pg_restore --username opensidebar_owner \
    --list < "$archive" > /dev/null
fi
age --recipient "${BACKUP_AGE_RECIPIENT}" --output "$encrypted" "$archive"
aws s3 cp "$encrypted" "s3://${BACKUP_BUCKET}/postgres/${cadence}/opensidebar-${timestamp}.dump.age"
sh "$(dirname "$0")/prune-backups.sh" "$cadence"
