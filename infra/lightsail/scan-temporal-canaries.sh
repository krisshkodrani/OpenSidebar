#!/usr/bin/env sh
set -eu

pattern='CANARY_|canary@example.invalid|canary.invalid|session=CANARY'
log_hits=0
for container in \
  opensidebar-temporal-spike-temporal-1 \
  opensidebar-temporal-spike-temporal-worker-1 \
  opensidebar-temporal-spike-temporal-namespace-1 \
  opensidebar-temporal-spike-temporal-schema-1
do
  hits="$(docker logs "$container" 2>&1 | grep -aEc "$pattern" || true)"
  echo "log:$container:$hits"
  log_hits=$((log_hits + hits))
done

database_hits=0
for database in temporal temporal_visibility; do
  hits="$(docker exec playscenario-db-1 pg_dump -U postgres "$database" | grep -aEc "$pattern" || true)"
  echo "database:$database:$hits"
  database_hits=$((database_hits + hits))
done

test "$log_hits" -eq 0
test "$database_hits" -eq 0
