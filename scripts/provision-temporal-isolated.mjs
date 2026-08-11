#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const apply = process.argv.includes("--apply");
const region = process.env.LIGHTSAIL_REGION || "eu-central-1";
const zone = process.env.LIGHTSAIL_AVAILABILITY_ZONE || `${region}a`;
const name = process.env.TEMPORAL_INSTANCE_NAME || "opensidebar-temporal-shadow";
const blueprint = process.env.LIGHTSAIL_BLUEPRINT_ID || "ubuntu_24_04";
const bundle = process.env.TEMPORAL_LIGHTSAIL_BUNDLE_ID || "micro_3_0";
const userData = readFileSync(new URL("../infra/temporal-isolated/cloud-init.sh", import.meta.url), "utf8");

const aws = (args, optional = false) => {
  try {
    return execFileSync("aws", [...args, "--region", region, "--no-cli-pager"], {
      encoding: "utf8", stdio: ["ignore", "pipe", optional ? "ignore" : "inherit"], timeout: 30_000,
    }).trim();
  } catch (error) { if (optional) return ""; throw error; }
};
const json = (args, optional = false) => {
  const output = aws([...args, "--output", "json"], optional);
  return output ? JSON.parse(output) : null;
};
const mutate = (args) => {
  console.log(`$ aws ${[...args, "--region", region].join(" ")}`);
  if (apply) aws(args);
};

if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,52}[A-Za-z0-9]$/.test(name)) throw new Error("Invalid instance name");
console.log(`${apply ? "APPLY" : "DRY RUN"}: isolated Temporal research host`);
console.log(`  instance: ${name}; bundle: ${bundle}; region: ${region}; zone: ${zone}`);
console.log("  expected: USD 7/month, 1 GB RAM, 2 vCPU, 40 GB disk");
console.log("  public services: none; SSH: Lightsail browser-connect only");
if (!apply) {
  console.log("No AWS calls were made. Add --apply after review.");
  process.exit(0);
}

const selected = json(["lightsail", "get-bundles", "--include-inactive", "--query", `bundles[?bundleId=='${bundle}']|[0]`]);
if (!selected || selected.isActive !== true || selected.price !== 7 || selected.ramSizeInGb !== 1 || selected.cpuCount !== 2 || selected.diskSizeInGb !== 40)
  throw new Error(`Refusing unexpected bundle: ${JSON.stringify(selected)}`);
let instance = json(["lightsail", "get-instance", "--instance-name", name], true)?.instance;
if (!instance) {
  mutate(["lightsail", "create-instances", "--instance-names", name, "--availability-zone", zone,
    "--blueprint-id", blueprint, "--bundle-id", bundle, "--ip-address-type", "ipv4",
    "--user-data", userData, "--tags", "key=project,value=opensidebar", "key=purpose,value=temporal-shadow-research"]);
  console.log("Creation started; rerun after the instance reaches running.");
  process.exit(0);
}
if (instance.bundleId !== bundle || instance.blueprintId !== blueprint) throw new Error("Existing instance does not match LP-33");
mutate(["lightsail", "put-instance-public-ports", "--instance-name", name, "--port-infos",
  JSON.stringify([{ fromPort: 22, toPort: 22, protocol: "tcp", cidrListAliases: ["lightsail-connect"] }])]);
mutate(["lightsail", "update-instance-metadata-options", "--instance-name", name,
  "--http-tokens", "required", "--http-endpoint", "enabled", "--http-put-response-hop-limit", "1", "--http-protocol-ipv6", "disabled"]);
console.log(`Converged. Private IP: ${instance.privateIpAddress}. No product flag was changed.`);
