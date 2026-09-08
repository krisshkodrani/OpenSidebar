#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(CDPATH= cd -- "$script_dir/../.." && pwd)"
compose_file="$script_dir/compose.temporal-spike.yaml"
env_file="$script_dir/.env.temporal-spike"
worker_image="${OPENSIDEBAR_TEMPORAL_WORKER_IMAGE:-opensidebar-temporal-spike:research}"
network="playscenario_default"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
result_dir="${TEMPORAL_SPIKE_RESULT_DIR:-$repo_dir/.artifacts/temporal-spike/recovery-sustained-$timestamp}"
started=false
compose() { docker compose --env-file "$env_file" -f "$compose_file" --profile temporal-spike "$@"; }
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$started" = true ]; then compose down >>"$result_dir/cleanup.log" 2>&1 || status=1; fi
  exit "$status"
}
trap cleanup EXIT INT TERM
mkdir -p "$result_dir"
chmod 700 "$result_dir"

if docker inspect opensidebar-cloud-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -Eq '^(CLOUD_SESSIONS|CHECKPOINT_WRITES|CHECKPOINT_RESTORE|DEVICE_COMMANDS|DEVICE_TAKEOVER|TEMPORAL_SHADOW|TEMPORAL_COORDINATION)_ENABLED=true$'; then
  echo "A production cloud-session or Temporal flag is enabled" >&2
  exit 1
fi
compose up -d
started=true
attempt=0
until docker run --rm --network "$network" temporalio/admin-tools:1.30.4@sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5 temporal operator namespace describe --address temporal:7233 opensidebar-spike >/dev/null 2>&1; do
  attempt=$((attempt + 1)); test "$attempt" -lt 30; sleep 1
done

TEMPORAL_SPIKE_RESULT_DIR="$result_dir" "$script_dir/drill-temporal-isolated-restore.sh" >"$result_dir/isolated-restore.log"
docker run --rm --network "$network" -e TEMPORAL_ADDRESS=temporal:7233 -e TEMPORAL_NAMESPACE=opensidebar-spike -e TEMPORAL_TASK_QUEUE=opensidebar-spike-v1 "$worker_image" node dist/run-stuck-operation-drill.js >"$result_dir/stuck-operation.json"

(
  while :; do
    sampled_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    api_latency_ms="$(docker exec opensidebar-cloud-api node -e "const s=performance.now();fetch('http://127.0.0.1:8787/health/ready').then(r=>{if(!r.ok)process.exit(1);process.stdout.write(String(Math.round(performance.now()-s)))})")"
    printf '{"sampledAt":"%s","hostAvailableBytes":%s,"rootAvailableBytes":%s,"cloudApiReadyLatencyMs":%s}\n' "$sampled_at" "$(free -b | awk '/^Mem:/ {print $7}')" "$(df -B1 / | awk 'NR==2 {print $4}')" "$api_latency_ms"
    docker stats --no-stream --format '{{json .}}'
    sleep 2
  done
) >"$result_dir/resource-samples.jsonl" &
sampler_pid=$!
SUSTAINED_ITERATIONS="${SUSTAINED_ITERATIONS:-12}" docker run --rm --network "$network" -e TEMPORAL_ADDRESS=temporal:7233 -e TEMPORAL_NAMESPACE=opensidebar-spike -e TEMPORAL_TASK_QUEUE=opensidebar-spike-v1 -e SUSTAINED_ITERATIONS "$worker_image" node dist/run-sustained-load.js >"$result_dir/sustained-load.json"
kill "$sampler_pid" >/dev/null 2>&1 || true
wait "$sampler_pid" 2>/dev/null || true
"$script_dir/scan-temporal-canaries.sh" >"$result_dir/canary-scan.txt"
docker inspect opensidebar-cloud-api --format '{{.State.Health.Status}}' >"$result_dir/cloud-api-health.txt"
docker inspect playscenario-backend-1 --format '{{.State.Health.Status}}' >"$result_dir/playground-health.txt"
printf '%s\n' "$result_dir"
