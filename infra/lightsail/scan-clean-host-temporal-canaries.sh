#!/usr/bin/env sh
set -eu

canary='CANARY_AUTHORIZATION|CANARY_PROVIDER_KEY|CANARY_COOKIE|CANARY_PROMPT_TEXT|CANARY_SCREENSHOT_BYTES|CANARY_CHECKPOINT_PLAINTEXT|canary@example.invalid|canary.invalid/private'
count_matches() {
  grep -E -c "$canary" || true
}
log_count="$(docker logs temporal-restored-server 2>&1 | count_matches)"
database_count="$(docker exec -u postgres temporal-restore-postgres pg_dump -Fp temporal | count_matches)"
visibility_count="$(docker exec -u postgres temporal-restore-postgres pg_dump -Fp temporal_visibility | count_matches)"
printf '{"schemaVersion":1,"logs":%s,"temporal":%s,"visibility":%s}\n' \
  "$log_count" "$database_count" "$visibility_count"
