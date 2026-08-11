#!/usr/bin/env sh
set -eu

docker network inspect temporal-restore-network >/dev/null 2>&1 ||
  docker network create temporal-restore-network >/dev/null
docker network connect temporal-restore-network temporal-restore-postgres 2>/dev/null || true
if ! docker container inspect temporal-restored-server >/dev/null 2>&1; then
  docker run -d --name temporal-restored-server --restart no --memory 640m --cpus 0.6 \
  --network temporal-restore-network \
  -e DB=postgres12 -e DB_PORT=5432 \
  -e POSTGRES_SEEDS=temporal-restore-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PWD=restore-drill-only \
  -e DBNAME=temporal -e VISIBILITY_DBNAME=temporal_visibility \
  -e SKIP_SCHEMA_SETUP=true \
  -v /tmp/temporal-dynamicconfig.yaml:/etc/temporal/config/dynamicconfig/docker.yaml:ro \
    temporalio/server:1.30.4@sha256:a8b99ed4d48b01604f1ed05318f14457dd84bf5fda2bd2bb3992e7297c48baa1 >/dev/null
fi

ready=false
for attempt in $(seq 1 60); do
  if docker run --rm --network temporal-restore-network \
    temporalio/admin-tools:1.30.4@sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5 \
    temporal operator namespace describe --address temporal-restored-server:7233 \
    opensidebar-spike >/tmp/restored-namespace.txt 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true
docker run --rm --network temporal-restore-network \
  temporalio/admin-tools:1.30.4@sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5 \
  temporal workflow list --address temporal-restored-server:7233 \
  --namespace opensidebar-spike --limit 5 >/tmp/restored-workflows.txt
test -z "$(docker port temporal-restored-server)"
workflow_lines="$(wc -l </tmp/restored-workflows.txt | tr -d ' ')"
printf '{"schemaVersion":1,"restoredTemporalReady":true,"namespace":"opensidebar-spike","workflowListLines":%s,"publishedPorts":false}\n' \
  "$workflow_lines"
