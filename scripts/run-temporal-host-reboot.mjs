#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";

const profile = process.env.AWS_PROFILE || "aipoweredapps-admin";
const region = process.env.AWS_REGION || "eu-central-1";
const instance = process.env.LIGHTSAIL_INSTANCE_NAME || "playscenario-launch-small";
const remoteRoot = "/opt/opensidebar-temporal-spike";
const composeDir = `${remoteRoot}/infra/lightsail`;
const compose =
  "sudo docker compose --env-file .env.temporal-spike -f compose.temporal-spike.yaml --profile temporal-spike";
const adminImage =
  "temporalio/admin-tools:1.30.4@sha256:0e5da5cb6714e457b10e4015d4b2091f3d822a21912de733a512832ae3baadb5";
const workerImage = "opensidebar-temporal-spike:research";
const timestamp = new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const resultDir = `${remoteRoot}/.artifacts/temporal-spike/host-reboot-${timestamp}`;

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options }).trim();

const aws = (...args) => run("aws", [...args, "--region", region, "--profile", profile]);
const ip = aws(
  "lightsail",
  "get-instance",
  "--instance-name",
  instance,
  "--query",
  "instance.publicIpAddress",
  "--output",
  "text",
);
const sshArgs = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", `ubuntu@${ip}`];
const ssh = (command, options = {}) => run("ssh", [...sshArgs, command], options);
const writeRemoteJson = (path, value) => {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64");
  ssh(`printf '%s' '${encoded}' | base64 -d | sudo tee '${path}' >/dev/null`);
};

const waitForSsh = async () => {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const result = spawnSync("ssh", [...sshArgs, "true"], {
      encoding: "utf8",
      stdio: "ignore",
    });
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("lightsail_ssh_recovery_timeout");
};

let temporalStarted = false;
try {
  ssh(
    `set -eu; test "$(sudo docker inspect playscenario-db-1 --format '{{.State.Health.Status}}')" = healthy; test "$(sudo docker inspect opensidebar-cloud-api --format '{{.State.Health.Status}}')" = healthy; sudo mkdir -p '${resultDir}'; sudo chmod 700 '${resultDir}'; cd '${composeDir}'; ${compose} up -d`,
  );
  temporalStarted = true;
  const prepared = JSON.parse(
    ssh(
      `sudo docker run --rm --network playscenario_default -e TEMPORAL_ADDRESS=temporal:7233 -e TEMPORAL_NAMESPACE=opensidebar-spike -e TEMPORAL_TASK_QUEUE=opensidebar-spike-v1 ${workerImage} node dist/run-worker-restart-drill.js prepare`,
    ),
  );
  writeRemoteJson(`${resultDir}/prepared.json`, prepared);

  aws("lightsail", "reboot-instance", "--instance-name", instance);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  await waitForSsh();

  ssh(
    `set -eu; cd '${composeDir}'; ${compose} up -d; attempt=0; until sudo docker run --rm --network playscenario_default ${adminImage} temporal operator namespace describe --address temporal:7233 opensidebar-spike >/dev/null 2>&1; do attempt=$((attempt + 1)); test "$attempt" -lt 60; sleep 1; done`,
  );
  const completed = ssh(
    `sudo docker run --rm --network playscenario_default -e TEMPORAL_ADDRESS=temporal:7233 -e TEMPORAL_NAMESPACE=opensidebar-spike -e WORKFLOW_ID='${prepared.workflowId}' -e COMMAND_ID='${prepared.commandId}' ${workerImage} node dist/run-worker-restart-drill.js complete`,
  );
  const completedResult = JSON.parse(completed);
  writeRemoteJson(`${resultDir}/completed.json`, completedResult);
  ssh(
    `set -eu; sudo '${composeDir}/scan-temporal-canaries.sh' > /tmp/host-reboot-canary.txt; sudo mv /tmp/host-reboot-canary.txt '${resultDir}/canary-scan.txt'; for container in playscenario-db-1 opensidebar-cloud-api playscenario-backend-1 playscenario-celery-1; do attempt=0; until [ "$(sudo docker inspect "$container" --format '{{.State.Health.Status}}')" = healthy ]; do attempt=$((attempt + 1)); test "$attempt" -lt 180; sleep 1; done; done; sudo sh -c "docker stats --no-stream --format '{{json .}}' > '${resultDir}/container-stats.jsonl'"; sudo sh -c "free -b > '${resultDir}/host-memory.txt'"`,
  );
  writeRemoteJson(`${resultDir}/production-health.json`, {
    database: "healthy",
    cloudApi: "healthy",
    playgroundBackend: "healthy",
    playgroundCelery: "healthy",
  });
  process.stdout.write(`${resultDir}\n`);
} finally {
  if (temporalStarted) {
    spawnSync("ssh", [...sshArgs, `cd '${composeDir}' && ${compose} down`], {
      encoding: "utf8",
      stdio: "inherit",
    });
  }
}
