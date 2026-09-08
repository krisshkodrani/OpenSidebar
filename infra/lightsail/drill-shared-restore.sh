#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
set -a
. "$ENV_FILE"
set +a
: "${PLAYGROUND_POSTGRES_CONTAINER:?set PLAYGROUND_POSTGRES_CONTAINER}"

archive=$(mktemp /tmp/opensidebar-restore-drill.XXXXXX.dump)
chmod 0600 "$archive"
trap 'rm -f -- "$archive"' EXIT INT TERM
source_session_rows=$(docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" psql -At \
  --username postgres --dbname "${PLAYGROUND_DB_NAME:-opensidebar}" \
  --command "SELECT count(*) FROM sessions.cloud_sessions")
source_checkpoint_rows=$(docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" psql -At \
  --username postgres --dbname "${PLAYGROUND_DB_NAME:-opensidebar}" \
  --command "SELECT count(*) FROM sessions.cloud_checkpoints")
docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" pg_dump \
  --username postgres --dbname "${PLAYGROUND_DB_NAME:-opensidebar}" \
  --format=custom > "$archive"
docker exec -i -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" pg_restore \
  --list < "$archive" > /dev/null
"$(dirname "$0")/restore.sh" --decrypted-stdin < "$archive"
restored_session_rows=$(docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" psql -At \
  --username postgres --dbname opensidebar_restore \
  --command "SELECT count(*) FROM sessions.cloud_sessions")
restored_checkpoint_rows=$(docker exec -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" psql -At \
  --username postgres --dbname opensidebar_restore \
  --command "SELECT count(*) FROM sessions.cloud_checkpoints")
test "$source_session_rows" = "$restored_session_rows"
test "$source_checkpoint_rows" = "$restored_checkpoint_rows"
printf '{"schemaVersion":1,"isolatedDatabase":"opensidebar_restore","liveDatabaseModified":false,"sessionRows":%s,"checkpointRows":%s,"restoreExitOnError":true}\n' \
  "$restored_session_rows" "$restored_checkpoint_rows"
