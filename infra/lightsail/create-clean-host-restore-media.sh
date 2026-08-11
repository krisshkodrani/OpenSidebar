#!/usr/bin/env sh
set -eu

output_dir="${1:?usage: create-clean-host-restore-media.sh OUTPUT_DIR}"
db_container="${PLAYGROUND_POSTGRES_CONTAINER:-playscenario-db-1}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$output_dir"
chmod 700 "$output_dir"
identity="$output_dir/restore-drill-${timestamp}.agekey"
recipient_file="$output_dir/restore-drill-${timestamp}.recipient"
age-keygen -o "$identity" 2>"$recipient_file"
chmod 600 "$identity"
recipient="$(sed -n 's/^Public key: //p' "$recipient_file")"
test -n "$recipient"

for database in opensidebar temporal temporal_visibility; do
  archive="$output_dir/$database.dump"
  encrypted="$archive.age"
  docker exec -u postgres "$db_container" pg_dump --username postgres \
    --dbname "$database" --format custom --no-owner >"$archive"
  docker exec -i -u postgres "$db_container" pg_restore --list <"$archive" >/dev/null
  age --recipient "$recipient" --output "$encrypted" "$archive"
  rm -f -- "$archive"
done

(
  cd "$output_dir"
  sha256sum ./*.dump.age >SHA256SUMS
)
printf '{"schemaVersion":1,"createdAt":"%s","encrypted":true,"databases":["opensidebar","temporal","temporal_visibility"]}\n' \
  "$timestamp" >"$output_dir/manifest.json"
printf '%s\n' "$output_dir"
