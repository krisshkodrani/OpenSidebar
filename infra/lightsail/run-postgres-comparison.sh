#!/usr/bin/env sh
set -eu

: "${POSTGRES_COMPARISON_BUNDLE:?set POSTGRES_COMPARISON_BUNDLE}"
: "${POSTGRES_COMPARISON_MIGRATIONS:?set POSTGRES_COMPARISON_MIGRATIONS}"
test -r "$POSTGRES_COMPARISON_BUNDLE"
test -r "$POSTGRES_COMPARISON_MIGRATIONS/002_control.sql"
test -r "$POSTGRES_COMPARISON_MIGRATIONS/003_sessions.sql"
test -r "$POSTGRES_COMPARISON_MIGRATIONS/004_command_payloads.sql"
test -r "$POSTGRES_COMPARISON_MIGRATIONS/006_postgres_durability_maintenance.sql"

container="playscenario-db-1"
owner="postgres"
database="opensidebar_comparison"
role="opensidebar_comparison"
password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
image="${OPENSIDEBAR_API_IMAGE:-opensidebar-cloud-service:milestone2-disabled-v4}"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  docker exec "$container" psql -U "$owner" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$database' AND pid<>pg_backend_pid()" \
    >/dev/null 2>&1 || status=1
  docker exec "$container" dropdb -U "$owner" --if-exists "$database" \
    >/dev/null 2>&1 || status=1
  docker exec "$container" psql -U "$owner" -d postgres -c \
    "DROP ROLE IF EXISTS $role" >/dev/null 2>&1 || status=1
  exit "$status"
}
trap cleanup EXIT INT TERM

test "$(docker inspect "$container" --format '{{.State.Health.Status}}')" = "healthy"
test "$(docker exec "$container" psql -U "$owner" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$database'")" != "1"
test "$(docker exec "$container" psql -U "$owner" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$role'")" != "1"

docker exec "$container" psql -U "$owner" -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE ROLE $role LOGIN PASSWORD '$password'" >/dev/null
docker exec "$container" createdb -U "$owner" -O "$role" "$database"

docker run --rm --network playscenario_default \
  -e "POSTGRES_COMPARISON_DATABASE_URL=postgresql://$role:$password@db:5432/$database" \
  -v "$POSTGRES_COMPARISON_BUNDLE:/app/dist/postgres-comparison-runner.js:ro" \
  -v "$POSTGRES_COMPARISON_MIGRATIONS:/app/migrations:ro" \
  "$image" node /app/dist/postgres-comparison-runner.js
