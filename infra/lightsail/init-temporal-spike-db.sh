#!/usr/bin/env sh
set -eu

: "${TEMPORAL_DB_PASSWORD:?set TEMPORAL_DB_PASSWORD}"

container="${POSTGRES_CONTAINER:-playscenario-db-1}"
owner="${POSTGRES_OWNER:-postgres}"
role="temporal_service"

case "$TEMPORAL_DB_PASSWORD" in
  *[!A-Za-z0-9_-]* | "")
    echo "TEMPORAL_DB_PASSWORD must contain only letters, numbers, underscore, or hyphen" >&2
    exit 1
    ;;
esac

psql() {
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U "$owner" -d postgres "$@"
}

if [ "$(psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$role'")" != "1" ]; then
  psql -c "CREATE ROLE $role LOGIN PASSWORD '$TEMPORAL_DB_PASSWORD'"
else
  psql -c "ALTER ROLE $role PASSWORD '$TEMPORAL_DB_PASSWORD'"
fi

for database in temporal temporal_visibility; do
  if [ "$(psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$database'")" != "1" ]; then
    docker exec "$container" createdb -U "$owner" -O "$role" "$database"
  fi
done

umask 077
cat > .env.temporal-spike <<EOF
TEMPORAL_DB_USER=$role
TEMPORAL_DB_PASSWORD=$TEMPORAL_DB_PASSWORD
EOF

psql -tAc \
  "SELECT datname || ':' || pg_catalog.pg_get_userbyid(datdba) FROM pg_database WHERE datname IN ('temporal', 'temporal_visibility') ORDER BY datname"
