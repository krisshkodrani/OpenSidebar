#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose="docker compose --env-file /etc/opensidebar-temporal/isolated.env -f $script_dir/compose.yaml"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
result_dir=${TEMPORAL_ISOLATED_RESULT_DIR:-$script_dir/.artifacts/$timestamp}
mkdir -p "$result_dir"

cleanup() { $compose down >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
$compose config --quiet
test -z "$($compose config | grep -E '^\s+ports:' || true)"
$compose up -d --build

attempt=0
until docker run --rm --network opensidebar-temporal-isolated_isolated temporalio/admin-tools:1.30.4@sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5 \
  temporal operator namespace describe --address temporal:7233 opensidebar-shadow >/dev/null 2>&1; do
  attempt=$((attempt + 1)); test "$attempt" -lt 90; sleep 2
done

worker_image=${OPENSIDEBAR_TEMPORAL_WORKER_IMAGE:-opensidebar-temporal-spike:isolated}
docker rm -f opensidebar-temporal-isolated-load >/dev/null 2>&1 || true
docker run --rm --name opensidebar-temporal-isolated-load --network opensidebar-temporal-isolated_isolated \
  -e TEMPORAL_ADDRESS=temporal:7233 -e TEMPORAL_NAMESPACE=opensidebar-shadow \
  -e TEMPORAL_TASK_QUEUE=opensidebar-shadow-v1 "$worker_image" node dist/run-fixtures.js >"$result_dir/fixtures.json"
docker run --rm --network opensidebar-temporal-isolated_isolated \
  -e TEMPORAL_ADDRESS=temporal:7233 -e TEMPORAL_NAMESPACE=opensidebar-shadow \
  -e TEMPORAL_TASK_QUEUE=opensidebar-shadow-v1 "$worker_image" node dist/run-load-fixtures.js >"$result_dir/corrected-burst.json"

swap_start=$(awk '/pswpout/{print $2}' /proc/vmstat)
docker run --rm --network opensidebar-temporal-isolated_isolated \
  -e TEMPORAL_ADDRESS=temporal:7233 -e TEMPORAL_NAMESPACE=opensidebar-shadow \
  -e TEMPORAL_TASK_QUEUE=opensidebar-shadow-v1 -e SUSTAINED_ITERATIONS="${SUSTAINED_ITERATIONS:-120}" \
  "$worker_image" node dist/run-sustained-load.js >"$result_dir/sustained-load.json" &
load_pid=$!

i=0
resource_failed=0
while [ "$i" -lt "${TEMPORAL_SAMPLE_COUNT:-60}" ]; do
  date -u +%s >>"$result_dir/host-memory.jsonl"
  memory_json=$(free -b | awk '/Mem:/ {printf "{\"total\":%s,\"used\":%s,\"available\":%s}\n",$2,$3,$7}')
  printf '%s\n' "$memory_json" >>"$result_dir/host-memory.jsonl"
  docker stats --no-stream --format '{{json .}}' >>"$result_dir/container-stats.jsonl"
  vmstat 1 2 | tail -1 >>"$result_dir/vmstat.txt"
  current_available=$(printf '%s\n' "$memory_json" | sed -E 's/.*"available":([0-9]+).*/\1/')
  if [ "$current_available" -lt 157286400 ]; then
    resource_failed=1
    docker stop opensidebar-temporal-isolated-load >/dev/null 2>&1 || true
    break
  fi
  i=$((i + 1)); sleep 4
done
wait "$load_pid" || true
swap_end=$(awk '/pswpout/{print $2}' /proc/vmstat)
swap_delta=$((swap_end - swap_start))

$compose logs --no-color >"$result_dir/containers.log"
if grep -Eqi 'CANARY_(AUTHORIZATION|PROVIDER_KEY|COOKIE|PROMPT_TEXT|SCREENSHOT_BYTES|CHECKPOINT_PLAINTEXT)|canary@example\.invalid|canary\.invalid/private' "$result_dir/containers.log"; then
  echo "forbidden canary found in logs" >&2; exit 1
fi
for database in temporal temporal_visibility; do
  $compose exec -T db pg_dump -Fp -U temporal_service "$database" >"$result_dir/$database.sql"
  if grep -Eqi 'CANARY_(AUTHORIZATION|PROVIDER_KEY|COOKIE|PROMPT_TEXT|SCREENSHOT_BYTES|CHECKPOINT_PLAINTEXT)|canary@example\.invalid|canary\.invalid/private' "$result_dir/$database.sql"; then
    echo "forbidden canary found in $database" >&2; exit 1
  fi
done
$compose exec -T db createdb -U temporal_service temporal_restore_gate
$compose exec -T db pg_dump -Fc -U temporal_service temporal |
  $compose exec -T db pg_restore --exit-on-error --no-owner -U temporal_service -d temporal_restore_gate
$compose exec -T db dropdb -U temporal_service temporal_restore_gate
min_available=$(awk -F'"available":' '/available/{gsub(/}.*/,"",$2); if(min==""||$2<min)min=$2} END{print min+0}' "$result_dir/host-memory.jsonl")
test "$min_available" -ge 157286400
test "$(docker inspect opensidebar-temporal-isolated-temporal-1 --format '{{.RestartCount}}')" -eq 0
test "$(docker inspect opensidebar-temporal-isolated-worker-1 --format '{{.RestartCount}}')" -eq 0
test "$(docker inspect opensidebar-temporal-isolated-temporal-1 --format '{{.State.OOMKilled}}')" = false
test "$(docker inspect opensidebar-temporal-isolated-worker-1 --format '{{.State.OOMKilled}}')" = false
test "$swap_delta" -le 256
disk_free_percent=$(df -P "$script_dir" | awk 'NR==2 {gsub(/%/,"",$5); print 100-$5}')
test "$disk_free_percent" -ge 40
test "$resource_failed" -eq 0
printf '{"schemaVersion":1,"passed":true,"minAvailableBytes":%s,"diskFreePercent":%s,"swapOutPages":%s,"publishedPorts":false}\n' \
  "$min_available" "$disk_free_percent" "$swap_delta" >"$result_dir/gate-report.json"
echo "PASS: $result_dir/gate-report.json"
