#!/usr/bin/env node
/**
 * Idempotent Lightsail foundation for the first Playground deployment.
 *
 * Dry-run is the default. Pass --apply to create or mutate AWS resources.
 * The script intentionally performs one convergent pass: after a new instance
 * reaches "running", rerun it to attach the static IP and backup bucket.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const apply = process.argv.includes("--apply");
const region = process.env.LIGHTSAIL_REGION || "eu-central-1";
const availabilityZone = process.env.LIGHTSAIL_AVAILABILITY_ZONE || `${region}a`;
const instanceName = process.env.LIGHTSAIL_INSTANCE_NAME || "opensidebar-test";
const staticIpName = process.env.LIGHTSAIL_STATIC_IP_NAME || `${instanceName}-ip`;
const blueprintId = process.env.LIGHTSAIL_BLUEPRINT_ID || "ubuntu_24_04";
const bundleId = process.env.LIGHTSAIL_BUNDLE_ID || "small_3_0";
const backupBucket = process.env.LIGHTSAIL_BACKUP_BUCKET || "opensidebar-backups";
const backupBundleId = process.env.LIGHTSAIL_BACKUP_BUNDLE_ID || "small_1_0";
const snapshotTime = process.env.LIGHTSAIL_SNAPSHOT_TIME || "02:00";
const cloudInitPath = fileURLToPath(new URL("../infra/lightsail/cloud-init.sh", import.meta.url));
const cloudInit = readFileSync(cloudInitPath, "utf8");

function aws(args, { optional = false } = {}) {
  try {
    return execFileSync("aws", [...args, "--region", region, "--no-cli-pager"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", optional ? "ignore" : "inherit"],
      timeout: 30_000,
    }).trim();
  } catch (error) {
    if (optional) return "";
    throw error;
  }
}

function json(args, options) {
  const value = aws([...args, "--output", "json"], options);
  return value ? JSON.parse(value) : null;
}

function mutate(args) {
  console.log(`$ aws ${[...args, "--region", region].join(" ")}`);
  if (apply) aws(args);
}

function assertName(name, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,52}[A-Za-z0-9]$/.test(name)) {
    throw new Error(`${label} has an invalid Lightsail resource name: ${name}`);
  }
}

function validateConfig() {
  assertName(instanceName, "LIGHTSAIL_INSTANCE_NAME");
  assertName(staticIpName, "LIGHTSAIL_STATIC_IP_NAME");
  if (!/^[a-z0-9][a-z0-9-]{1,52}[a-z0-9]$/.test(backupBucket)) {
    throw new Error(`LIGHTSAIL_BACKUP_BUCKET has an invalid bucket name: ${backupBucket}`);
  }
  if (!/^\d{2}:00$/.test(snapshotTime)) {
    throw new Error("LIGHTSAIL_SNAPSHOT_TIME must be an hourly UTC time such as 02:00.");
  }
}

validateConfig();
console.log(`${apply ? "APPLY" : "DRY RUN"}: Lightsail Playground foundation in ${region}`);
console.log(`  instance: ${instanceName} (${blueprintId}, ${bundleId}, ${availabilityZone})`);
console.log(`  static IP: ${staticIpName}`);
console.log(`  encrypted-backup bucket: ${backupBucket} (${backupBundleId})`);

if (!apply) {
  console.log("\nNo AWS calls were made. Re-run with --apply after reviewing these values.");
  process.exit(0);
}

execFileSync("aws", ["--version"], { stdio: "inherit", timeout: 10_000 });
const identity = json(["sts", "get-caller-identity"]);
console.log(`AWS account ${identity.Account}; caller ${identity.Arn}`);

const bundle = json([
  "lightsail", "get-bundles", "--include-inactive",
  "--query", `bundles[?bundleId=='${bundleId}']|[0]`,
]);
if (!bundle || bundle.isActive !== true) throw new Error(`Active bundle ${bundleId} was not found in ${region}.`);
if (bundle.price !== 12 || bundle.ramSizeInGb !== 2 || bundle.cpuCount !== 2 || bundle.diskSizeInGb !== 60) {
  throw new Error(`Refusing unexpected bundle: ${JSON.stringify({ id: bundle.bundleId, price: bundle.price, ram: bundle.ramSizeInGb, cpus: bundle.cpuCount, disk: bundle.diskSizeInGb })}`);
}

const blueprint = json([
  "lightsail", "get-blueprints", "--include-inactive",
  "--query", `blueprints[?blueprintId=='${blueprintId}']|[0]`,
]);
if (!blueprint || blueprint.isActive !== true || blueprint.platform !== "LINUX_UNIX") {
  throw new Error(`Active Linux blueprint ${blueprintId} was not found in ${region}.`);
}

let instance = json(["lightsail", "get-instance", "--instance-name", instanceName], { optional: true })?.instance;
if (!instance) {
  mutate([
    "lightsail", "create-instances", "--instance-names", instanceName,
    "--availability-zone", availabilityZone, "--blueprint-id", blueprintId,
    "--bundle-id", bundleId, "--ip-address-type", "ipv4",
    "--user-data", cloudInit,
    "--tags", "key=project,value=opensidebar", "key=environment,value=testing",
  ]);
  console.log("Instance creation started. Wait until it is running, then rerun this command.");
  process.exit(0);
}
if (instance.bundleId !== bundleId || instance.blueprintId !== blueprintId) {
  throw new Error(`Existing ${instanceName} does not match the approved blueprint/bundle.`);
}
if (instance.state?.name !== "running") {
  console.log(`Instance state is ${instance.state?.name || "unknown"}; rerun after it reaches running.`);
  process.exit(0);
}

mutate([
  "lightsail", "update-instance-metadata-options", "--instance-name", instanceName,
  "--http-tokens", "required", "--http-endpoint", "enabled",
  "--http-put-response-hop-limit", "1", "--http-protocol-ipv6", "disabled",
]);

const ports = [
  { fromPort: 80, toPort: 80, protocol: "tcp", cidrs: ["0.0.0.0/0"] },
  { fromPort: 443, toPort: 443, protocol: "tcp", cidrs: ["0.0.0.0/0"] },
];
mutate([
  "lightsail", "put-instance-public-ports", "--instance-name", instanceName,
  "--port-infos", JSON.stringify(ports),
]);
mutate([
  "lightsail", "enable-add-on", "--resource-name", instanceName,
  "--add-on-request", `addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=${snapshotTime}}`,
]);

let staticIp = json(["lightsail", "get-static-ip", "--static-ip-name", staticIpName], { optional: true })?.staticIp;
if (!staticIp) {
  mutate(["lightsail", "allocate-static-ip", "--static-ip-name", staticIpName]);
  staticIp = json(["lightsail", "get-static-ip", "--static-ip-name", staticIpName]);
}
if (!staticIp?.isAttached) {
  mutate(["lightsail", "attach-static-ip", "--static-ip-name", staticIpName, "--instance-name", instanceName]);
} else if (staticIp.attachedTo !== instanceName) {
  throw new Error(`${staticIpName} is already attached to ${staticIp.attachedTo}; refusing reassignment.`);
}

let bucket = json([
  "lightsail", "get-buckets", "--query", `buckets[?name=='${backupBucket}']|[0]`,
], { optional: true });
if (!bucket) {
  const bucketBundle = json([
    "lightsail", "get-bucket-bundles",
    "--query", `bundles[?bundleId=='${backupBundleId}']|[0]`,
  ]);
  if (!bucketBundle || bucketBundle.isActive === false || bucketBundle.price > 1) {
    throw new Error(`Refusing backup bundle ${backupBundleId}; expected the active $1/month plan.`);
  }
  mutate([
    "lightsail", "create-bucket", "--bucket-name", backupBucket,
    "--bundle-id", backupBundleId, "--enable-object-versioning",
    "--tags", "key=project,value=opensidebar", "key=purpose,value=encrypted-backups",
  ]);
  console.log("Backup bucket creation started. Rerun after its state reaches OK to attach instance access.");
  process.exit(0);
}
if (bucket && bucket.objectVersioning !== "Enabled") {
  mutate(["lightsail", "update-bucket", "--bucket-name", backupBucket, "--versioning", "Enabled"]);
}
mutate([
  "lightsail", "set-resource-access-for-bucket", "--bucket-name", backupBucket,
  "--resource-name", instanceName, "--access", "allow",
]);

const finalIp = json(["lightsail", "get-static-ip", "--static-ip-name", staticIpName])?.staticIp;
console.log("\nFoundation converged.");
console.log(`  static IPv4: ${finalIp?.ipAddress || "check the Lightsail console"}`);
console.log(`  next DNS record: api-origin.opensidebar.com A ${finalIp?.ipAddress || "<static-ip>"}`);
console.log("  next host step: follow docs/engineering/lightsail-playground-runbook.md");
