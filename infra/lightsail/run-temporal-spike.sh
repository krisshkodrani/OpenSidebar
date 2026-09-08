#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(CDPATH= cd -- "$script_dir/../.." && pwd)"
compose_file="$script_dir/compose.temporal-spike.yaml"
env_file="$script_dir/.env.temporal-spike"
worker_image="${OPENSIDEBAR_TEMPORAL_WORKER_IMAGE:-opensidebar-temporal-spike:research}"
network="playscenario_default"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
result_dir="${TEMPORAL_SPIKE_RESULT_DIR:-$repo_dir/.artifacts/temporal-spike/$timestamp}"
started=false

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" --profile temporal-spike "$@"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$started" = true ]; then
    compose down >>"$result_dir/cleanup.log" 2>&1 || status=1
  fi
  if docker ps --format '{{.Names}}' | grep -q '^opensidebar-temporal-spike-'; then
    echo "Temporal spike containers remain after cleanup" >&2
    status=1
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

test -r "$env_file"
mkdir -p "$result_dir"
chmod 700 "$result_dir"

if docker inspect opensidebar-cloud-api --format '{{range .Config.Env}}{{println .}}{{end}}' |
  grep -Eq '^(CLOUD_SESSIONS|CHECKPOINT_WRITES|CHECKPOINT_RESTORE|DEVICE_COMMANDS|DEVICE_TAKEOVER|TEMPORAL_SHADOW|TEMPORAL_COORDINATION)_ENABLED=true$'
then
  echo "A production cloud-session or Temporal flag is enabled" >&2
  exit 1
fi

compose config --quiet
docker image inspect "$worker_image" --format '{{.Id}} {{.Size}}' >"$result_dir/worker-image.txt"
docker run --rm "$worker_image" npm audit --omit=dev --audit-level=high --json >"$result_dir/worker-audit.json"

compose up -d
started=true

attempt=0
until docker run --rm --network "$network" \
  temporalio/admin-tools:1.30.4@sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5 \
  temporal operator namespace describe --address temporal:7233 opensidebar-spike \
  >/dev/null 2>&1
do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    compose logs --no-color >"$result_dir/startup-failure.log" 2>&1 || true
    echo "Temporal namespace did not become ready" >&2
    exit 1
  fi
  sleep 1
done

port_binding="$(docker inspect opensidebar-temporal-spike-temporal-1 --format '{{json .NetworkSettings.Ports}}')"
test "$port_binding" = '{"7233/tcp":null}'
printf '%s\n' "$port_binding" >"$result_dir/port-binding.json"

docker run --rm --network "$network" \
  -e TEMPORAL_ADDRESS=temporal:7233 \
  -e TEMPORAL_NAMESPACE=opensidebar-spike \
  -e TEMPORAL_TASK_QUEUE=opensidebar-spike-v1 \
  "$worker_image" node dist/run-fixtures.js >"$result_dir/fixtures.json"

restart_state="$(docker run --rm --network "$network" \
  -e TEMPORAL_ADDRESS=temporal:7233 \
  -e TEMPORAL_NAMESPACE=opensidebar-spike \
  -e TEMPORAL_TASK_QUEUE=opensidebar-spike-v1 \
  "$worker_image" node dist/run-worker-restart-drill.js prepare)"
workflow_id="$(printf '%s' "$restart_state" | sed -n 's/.*"workflowId":"\([^"]*\)".*/\1/p')"
command_id="$(printf '%s' "$restart_state" | sed -n 's/.*"commandId":"\([^"]*\)".*/\1/p')"
test -n "$workflow_id"
test -n "$command_id"
compose stop temporal-worker >"$result_dir/worker-restart.log" 2>&1
compose start temporal-worker >>"$result_dir/worker-restart.log" 2>&1
docker run --rm --network "$network" \
  -e TEMPORAL_ADDRESS=temporal:7233 \
  -e TEMPORAL_NAMESPACE=opensidebar-spike \
  -e WORKFLOW_ID="$workflow_id" \
  -e COMMAND_ID="$command_id" \
  "$worker_image" node dist/run-worker-restart-drill.js complete \
  >"$result_dir/worker-restart.json"

restart_state="$(docker run --rm --network "$network" \
  -e TEMPORAL_ADDRESS=temporal:7233 \
  -e TEMPORAL_NAMESPACE=opensidebar-spike \
  -e TEMPORAL_TASK_QUEUE=opensidebar-spike-v1 \
  "$worker_image" node dist/run-worker-restart-drill.js prepare)"
workflow_id="$(printf '%s' "$restart_state" | sed -n 's/.*"workflowId":"\([^"]*\)".*/\1/p')"
command_id="$(printf '%s' "$restart_state" | sed -n 's/.*"commandId":"\([^"]*\)".*/\1/p')"
test -n "$workflow_id"
test -n "$command_id"
compose stop temporal >"$result_dir/server-restart.log" 2>&1
compose start temporal >>"$result_dir/server-restart.log" 2>&1
attempt=0
until docker run --rm --network "$network" \
  temporalio/admin-tools:1.30.4@sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5 \
  temporal operator namespace describe --address temporal:7233 opensidebar-spike \
  >/dev/null 2>&1
do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    compose logs --no-color temporal >>"$result_dir/server-restart.log" 2>&1 || true
    echo "Temporal did not recover after restart" >&2
    exit 1
  fi
  sleep 1
done
docker run --rm --network "$network" \
  -e TEMPORAL_ADDRESS=temporal:7233 \
  -e TEMPORAL_NAMESPACE=opensidebar-spike \
  -e WORKFLOW_ID="$workflow_id" \
  -e COMMAND_ID="$command_id" \
  "$worker_image" node dist/run-worker-restart-drill.js complete \
  >"$result_dir/server-restart.json"

if [ "${TEMPORAL_SPIKE_SHARED_DB_RESTART:-false}" = "true" ]; then
  test "$(docker inspect playscenario-db-1 --format '{{.State.Health.Status}}')" = "healthy"
  test "$(docker inspect opensidebar-cloud-api --format '{{.State.Health.Status}}')" = "healthy"
  test "$(docker inspect playscenario-backend-1 --format '{{.State.Health.Status}}')" = "healthy"
  restart_state="$(docker run --rm --network "$network" \
    -e TEMPORAL_ADDRESS=temporal:7233 \
    -e TEMPORAL_NAMESPACE=opensidebar-spike \
    -e TEMPORAL_TASK_QUEUE=opensidebar-spike-v1 \
    "$worker_image" node dist/run-worker-restart-drill.js prepare)"
  workflow_id="$(printf '%s' "$restart_state" | sed -n 's/.*"workflowId":"\([^"]*\)".*/\1/p')"
  command_id="$(printf '%s' "$restart_state" | sed -n 's/.*"commandId":"\([^"]*\)".*/\1/p')"
  test -n "$workflow_id"
  test -n "$command_id"
  restart_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  docker restart playscenario-db-1 >"$result_dir/postgres-restart.log" 2>&1
  attempt=0
  until [ "$(docker inspect playscenario-db-1 --format '{{.State.Health.Status}}')" = "healthy" ]; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
      echo "PostgreSQL did not become healthy after restart" >&2
      exit 1
    fi
    sleep 1
  done
  if [ "$(docker inspect opensidebar-temporal-spike-temporal-1 --format '{{.State.Running}}')" != "true" ]; then
    compose start temporal >>"$result_dir/postgres-restart.log" 2>&1
  fi
  if [ "$(docker inspect opensidebar-temporal-spike-temporal-worker-1 --format '{{.State.Running}}')" != "true" ]; then
    compose start temporal-worker >>"$result_dir/postgres-restart.log" 2>&1
  fi
  attempt=0
  until docker run --rm --network "$network" \
    temporalio/admin-tools:1.30.4@sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5 \
    temporal operator namespace describe --address temporal:7233 opensidebar-spike \
    >/dev/null 2>&1
  do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
      echo "Temporal did not recover after PostgreSQL restart" >&2
      exit 1
    fi
    sleep 1
  done
  docker run --rm --network "$network" \
    -e TEMPORAL_ADDRESS=temporal:7233 \
    -e TEMPORAL_NAMESPACE=opensidebar-spike \
    -e WORKFLOW_ID="$workflow_id" \
    -e COMMAND_ID="$command_id" \
    "$worker_image" node dist/run-worker-restart-drill.js complete \
    >"$result_dir/postgres-restart-workflow.json"
  attempt=0
  until [ "$(docker inspect opensidebar-cloud-api --format '{{.State.Health.Status}}')" = "healthy" ]; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
      echo "Cloud API did not recover after PostgreSQL restart" >&2
      exit 1
    fi
    sleep 1
  done
  test "$(docker inspect playscenario-backend-1 --format '{{.State.Health.Status}}')" = "healthy"
  printf '{"startedAt":"%s","database":"healthy","cloudApi":"healthy","playgroundBackend":"healthy"}\n' \
    "$restart_started" >"$result_dir/postgres-restart.json"
else
  printf '{"skipped":true,"reason":"set TEMPORAL_SPIKE_SHARED_DB_RESTART=true"}\n' \
    >"$result_dir/postgres-restart.json"
fi

docker run --rm --network "$network" \
  -e TEMPORAL_ADDRESS=temporal:7233 \
  -e TEMPORAL_NAMESPACE=opensidebar-spike \
  -e TEMPORAL_TASK_QUEUE=opensidebar-spike-v1 \
  "$worker_image" node dist/run-load-fixtures.js >"$result_dir/load.json"

"$script_dir/scan-temporal-canaries.sh" >"$result_dir/canary-scan.txt"

docker inspect \
  opensidebar-temporal-spike-temporal-1 \
  opensidebar-temporal-spike-temporal-schema-1 \
  opensidebar-temporal-spike-temporal-worker-1 \
  --format '{{.Name}} {{.Config.Image}} {{.Image}}' >"$result_dir/images.txt"
docker stats --no-stream --format '{{json .}}' >"$result_dir/container-stats.jsonl"
free -b >"$result_dir/host-memory.txt"
df -B1 / >"$result_dir/host-disk.txt"
compose ps -a >"$result_dir/compose-ps.txt"

printf '%s\n' "$result_dir"
