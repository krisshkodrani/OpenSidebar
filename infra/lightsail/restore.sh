#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: restore.sh s3://bucket/postgres/daily/opensidebar-TIMESTAMP.dump.age | --decrypted-stdin" >&2
  exit 2
fi

encrypted="/tmp/opensidebar-restore.dump.age"
archive="/tmp/opensidebar-restore.dump"
trap 'rm -f "$archive" "$encrypted"' EXIT
if [ "$1" = "--decrypted-stdin" ]; then
  cat > "$archive"
else
  if [ -z "${BACKUP_AGE_IDENTITY_FILE:-}" ]; then
    echo "BACKUP_AGE_IDENTITY_FILE must point to the recovery identity, or decrypt offline and use --decrypted-stdin." >&2
    exit 2
  fi
  aws s3 cp "$1" "$encrypted"
  age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" --output "$archive" "$encrypted"
fi
if [ -n "${PLAYGROUND_POSTGRES_CONTAINER:-}" ]; then
  docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" dropdb --if-exists opensidebar_restore
  docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" createdb --owner playground_service opensidebar_restore
  docker exec -i -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" pg_restore \
    --dbname opensidebar_restore --clean --if-exists < "$archive"
  docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" psql \
    --dbname opensidebar_restore --command "SELECT count(*) FROM playground.runs; SELECT max(version) FROM control.schema_migrations; SELECT max(version) FROM sessions.schema_migrations; SELECT count(*) FROM sessions.session_jobs;"
else
  docker compose exec -T postgres dropdb --username opensidebar_owner --if-exists opensidebar_restore
  docker compose exec -T postgres createdb --username opensidebar_owner --owner opensidebar_owner opensidebar_restore
  docker compose exec -T postgres pg_restore --username opensidebar_owner \
    --dbname opensidebar_restore --clean --if-exists < "$archive"
  docker compose exec -T postgres psql --username opensidebar_owner \
    --dbname opensidebar_restore --command "SELECT count(*) FROM playground.runs; SELECT max(version) FROM control.schema_migrations; SELECT max(version) FROM sessions.schema_migrations; SELECT count(*) FROM sessions.session_jobs;"
fi
