#!/usr/bin/env sh
set -eu

media_dir="${1:?usage: restore-clean-host-media.sh MEDIA_DIR}"
identity="$(find "$media_dir" -maxdepth 1 -name '*.agekey' -type f | head -n 1)"
test -r "$identity"
cd "$media_dir"
sha256sum -c SHA256SUMS
started_at="$(date +%s)"

docker run -d --name temporal-restore-postgres \
  --restart no --memory 550m --cpus 0.7 \
  -e POSTGRES_PASSWORD=restore-drill-only \
  -v temporal-restore-data:/var/lib/postgresql/data \
  pgvector/pgvector:pg15
attempt=0
stable=0
until [ "$stable" -ge 3 ]; do
  attempt=$((attempt + 1)); test "$attempt" -lt 60
  if docker exec temporal-restore-postgres pg_isready -U postgres >/dev/null 2>&1; then
    stable=$((stable + 1))
  else
    stable=0
  fi
  sleep 1
done

for database in opensidebar temporal temporal_visibility; do
  archive="/tmp/$database.restore.dump"
  age --decrypt --identity "$identity" --output "$archive" "$media_dir/$database.dump.age"
  docker exec -u postgres temporal-restore-postgres createdb "$database"
  docker exec -i -u postgres temporal-restore-postgres pg_restore \
    --exit-on-error --no-owner --dbname "$database" <"$archive"
  rm -f -- "$archive"
done

app_tables="$(docker exec -u postgres temporal-restore-postgres psql -At -d opensidebar -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema';")"
temporal_tables="$(docker exec -u postgres temporal-restore-postgres psql -At -d temporal -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema';")"
visibility_tables="$(docker exec -u postgres temporal-restore-postgres psql -At -d temporal_visibility -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema';")"
test "$app_tables" -gt 0
test "$temporal_tables" -gt 0
test "$visibility_tables" -gt 0
elapsed="$(( $(date +%s) - started_at ))"
printf '{"schemaVersion":1,"cleanHost":true,"restoreSeconds":%s,"applicationTables":%s,"temporalTables":%s,"visibilityTables":%s,"checksumVerified":true,"restoreExitOnError":true}\n' \
  "$elapsed" "$app_tables" "$temporal_tables" "$visibility_tables"
