#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
env_file="$script_dir/.env.temporal-spike"
result_dir="${TEMPORAL_SPIKE_RESULT_DIR:?set TEMPORAL_SPIKE_RESULT_DIR}"
db_container="${PLAYGROUND_POSTGRES_CONTAINER:-playscenario-db-1}"
test -r "$env_file"
# shellcheck disable=SC1090
. "$env_file"
mkdir -p "$result_dir"
work_dir="$(mktemp -d /tmp/temporal-restore-drill.XXXXXX)"
restore_main="temporal_restore_drill"
restore_visibility="temporal_visibility_restore_drill"
cleanup() {
  docker exec -u postgres "$db_container" dropdb --if-exists "$restore_main" >/dev/null 2>&1 || true
  docker exec -u postgres "$db_container" dropdb --if-exists "$restore_visibility" >/dev/null 2>&1 || true
  rm -rf -- "$work_dir"
}
trap cleanup EXIT INT TERM

for database in temporal temporal_visibility; do
  docker exec -e PGPASSWORD="$TEMPORAL_DB_PASSWORD" "$db_container" \
    pg_dump -Fc --no-owner --username "$TEMPORAL_DB_USER" --dbname "$database" \
    >"$work_dir/$database.dump"
  test -s "$work_dir/$database.dump"
done

docker exec -u postgres "$db_container" createdb --owner "$TEMPORAL_DB_USER" "$restore_main"
docker exec -u postgres "$db_container" createdb --owner "$TEMPORAL_DB_USER" "$restore_visibility"
docker exec -i -e PGPASSWORD="$TEMPORAL_DB_PASSWORD" "$db_container" \
  pg_restore --exit-on-error --no-owner --username "$TEMPORAL_DB_USER" --dbname "$restore_main" \
  <"$work_dir/temporal.dump"
docker exec -i -e PGPASSWORD="$TEMPORAL_DB_PASSWORD" "$db_container" \
  pg_restore --exit-on-error --no-owner --username "$TEMPORAL_DB_USER" --dbname "$restore_visibility" \
  <"$work_dir/temporal_visibility.dump"

table_count() {
  docker exec -e PGPASSWORD="$TEMPORAL_DB_PASSWORD" "$db_container" psql -At -U "$TEMPORAL_DB_USER" -d "$1" \
    -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema';"
}
source_tables="$(table_count temporal)"
restored_tables="$(table_count "$restore_main")"
source_visibility_tables="$(table_count temporal_visibility)"
restored_visibility_tables="$(table_count "$restore_visibility")"
test "$source_tables" = "$restored_tables"
test "$source_visibility_tables" = "$restored_visibility_tables"
main_bytes="$(wc -c <"$work_dir/temporal.dump" | tr -d ' ')"
visibility_bytes="$(wc -c <"$work_dir/temporal_visibility.dump" | tr -d ' ')"
docker exec -u postgres "$db_container" dropdb "$restore_main"
docker exec -u postgres "$db_container" dropdb "$restore_visibility"
printf '{"schemaVersion":1,"isolated":true,"liveDatabasesModified":false,"persistenceTables":%s,"visibilityTables":%s,"persistenceDumpBytes":%s,"visibilityDumpBytes":%s,"restoreExitOnError":true,"restoredDatabasesDropped":true}\n' \
  "$restored_tables" "$restored_visibility_tables" "$main_bytes" "$visibility_bytes" >"$result_dir/isolated-restore.json"
cat "$result_dir/isolated-restore.json"
