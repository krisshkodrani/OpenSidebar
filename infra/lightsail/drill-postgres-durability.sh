#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || { echo "run as root" >&2; exit 2; }
image=${1:?pass the candidate cloud-service image}
db_container=${PLAYGROUND_POSTGRES_CONTAINER:-playscenario-db-1}
source_db=opensidebar_durability_drill
restore_db=opensidebar_durability_restore_drill
archive=$(mktemp /tmp/opensidebar-durability.XXXXXX.dump)
cleanup() {
  docker exec -u postgres "$db_container" dropdb --if-exists "$source_db" >/dev/null 2>&1 || true
  docker exec -u postgres "$db_container" dropdb --if-exists "$restore_db" >/dev/null 2>&1 || true
  rm -f -- "$archive"
}
trap cleanup EXIT INT TERM

cleanup
control_url=$(docker exec opensidebar-cloud-api printenv CONTROL_DATABASE_URL)
drill_url="${control_url%/*}/$source_db"
docker exec -u postgres "$db_container" createdb --owner opensidebar_service "$source_db"
handoff=$(docker run --rm --network playscenario_default \
  -e DRILL_DATABASE_URL="$drill_url" "$image" node dist/postgres-durability-drill.js)

docker exec -u postgres "$db_container" pg_dump --username postgres \
  --dbname "$source_db" --format=custom > "$archive"
docker exec -u postgres "$db_container" createdb --owner opensidebar_service "$restore_db"
docker exec -i -u postgres "$db_container" pg_restore --exit-on-error \
  --username postgres --dbname "$restore_db" < "$archive"

session_rows=$(docker exec -u postgres "$db_container" psql -At \
  --username postgres --dbname "$restore_db" \
  --command "SELECT count(*) FROM sessions.cloud_sessions")
device_rows=$(docker exec -u postgres "$db_container" psql -At \
  --username postgres --dbname "$restore_db" \
  --command "SELECT count(*) FROM control.devices")
lease_rows=$(docker exec -u postgres "$db_container" psql -At \
  --username postgres --dbname "$restore_db" \
  --command "SELECT count(*) FROM sessions.session_leases")
test "$session_rows" -eq 1
test "$device_rows" -eq 2
test "$lease_rows" -eq 2

printf '{"schemaVersion":1,"sourceDatabase":"%s","restoreDatabase":"%s","liveDatabaseModified":false,"sessionRows":%s,"deviceRows":%s,"leaseRows":%s,"restoreExitOnError":true,"handoff":%s}\n' \
  "$source_db" "$restore_db" "$session_rows" "$device_rows" "$lease_rows" "$handoff"
