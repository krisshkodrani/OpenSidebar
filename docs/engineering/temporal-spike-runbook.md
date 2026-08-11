# Temporal OSS bounded spike runbook

This runbook executes LP-32 research only. Temporal remains non-authoritative,
has no public route, and uses synthetic content-free workflow inputs. Do not add
the spike Compose file to the boot unit or production API deployment.

## Pinned starting matrix

- Temporal Server: `1.30.4`, amd64 digest
  `sha256:a8b99ed4d48b01604f1ed05318f14457dd84bf5fda2bd2bb3992e7297c48baa1`
- Temporal admin tools: `1.30.4`, amd64 digest
  `sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5`
- Temporal TypeScript SDK packages: `1.21.1`
- Node: 22
- PostgreSQL: the host's current `pgvector/pgvector:pg15`
- Host: existing Frankfurt 2-vCPU/2-GB/60-GB Lightsail instance

Before running, resolve and record each container's immutable repository digest,
scan the images, and stop if a critical/high finding lacks a reviewed mitigation.
An unpinned tag is forbidden.

Run a production-dependency audit of the worker image before startup. The first
candidate SDK (`1.17.2`) was rejected on 2026-08-08 because its protobuf chain
had high-severity advisories; `1.21.1` is the minimum reviewed spike pin and
must still report zero high/critical production findings when rebuilt.

## Isolation

Create separate `temporal` and `temporal_visibility` databases owned by a
dedicated `temporal_service` role. Do not grant that role access to the
`opensidebar` database. The one-shot schema container applies the pinned server
schemas before startup. The Compose file exposes port
7233 only to `playscenario_default`; Caddy/Nginx must have no Temporal route.
All services use the `temporal-spike` profile, `restart: no`, and explicit CPU,
memory, and log caps.

Initialize or rotate the dedicated role from the Compose directory with a
random alphanumeric password. The helper writes a mode-600
`.env.temporal-spike`; never commit or copy that file back to a workstation:

```sh
sudo env TEMPORAL_DB_PASSWORD='<random value>' ./init-temporal-spike-db.sh
```

After the fixtures finish, run `scan-temporal-canaries.sh` as root. It scans
the bounded container logs and logical dumps of both Temporal databases and
fails if any forbidden canary is present.

Start only during a measured spike window:

```sh
sudo ./run-temporal-spike.sh
```

The runner validates disabled production flags, audits the worker, starts the
private profile, waits for readiness, verifies that port 7233 has no host
binding, runs all seven fixtures, scans logs/databases, captures machine-readable
evidence under `.artifacts/temporal-spike/<UTC timestamp>/`, exercises a worker
restart and a Temporal server restart while workflows wait for their results,
then runs five concurrent sessions and a 25-device duplicate reconnect burst
before removing the
spike containers through an exit trap. A failing step makes the command fail.

The shared PostgreSQL restart drill is intentionally excluded by default
because the existing database container also serves the Playground and cloud
API. Run it only in an announced maintenance window:

```sh
sudo env TEMPORAL_SPIKE_SHARED_DB_RESTART=true ./run-temporal-spike.sh
```

The opt-in drill requires healthy database/API state before restarting, waits
for PostgreSQL and Temporal recovery, completes a workflow that was already
waiting, and verifies the cloud API is healthy afterward.

The full-host reboot drill is controlled from the operator workstation because
no process on the rebooted host can guarantee its own continuation. It requires
an active `aipoweredapps-admin` AWS SSO session and causes a short public-service
interruption:

```sh
pnpm temporal:host-reboot
```

The controller prepares a waiting workflow, requests the Lightsail reboot,
waits for SSH, restores only the private spike profile, resumes the same
workflow, verifies production health and privacy canaries, captures evidence,
and removes the spike containers.

Stop and remove the spike containers after each run:

```sh
docker compose -f compose.temporal-spike.yaml --profile temporal-spike down
```

Do not delete the Temporal database until its history scan, backup, and restore
evidence has been captured.

## Required evidence

Run all seven fixtures from LP-32. Capture whole-host/container CPU, RSS, swap,
disk, restart counts, API/Playground latency, workflow convergence, duplicate
dispatch count, operator steps, and restore duration. Scan exported histories
and bounded logs for every forbidden canary. Compare the same fixtures with the
authoritative PostgreSQL state machine.

Build and run the PostgreSQL-only comparison against a disposable database:

```sh
pnpm --filter opensidebar-cloud-service build:postgres-comparison
sudo env POSTGRES_COMPARISON_BUNDLE=/path/to/postgres-comparison-runner.js \
  POSTGRES_COMPARISON_MIGRATIONS=/path/to/apps/cloud-service/migrations \
  ./run-postgres-comparison.sh
```

The helper refuses to reuse an existing comparison database or role and removes
both through an exit trap.

Adoption remains a separate owner decision even if every threshold passes.
