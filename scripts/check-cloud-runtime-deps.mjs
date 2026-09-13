import fs from "node:fs";
import { parse } from "yaml";

const runtimeManifest = JSON.parse(
  fs.readFileSync("apps/cloud-service/package.runtime.json", "utf8"),
);
const lockfile = parse(fs.readFileSync("pnpm-lock.yaml", "utf8"));
const lockedDependencies = lockfile.importers?.["apps/cloud-service"]?.dependencies ?? {};
const mismatches = [];

for (const [name, runtimeVersion] of Object.entries(runtimeManifest.dependencies ?? {})) {
  const locked = lockedDependencies[name]?.version;
  const lockedVersion = typeof locked === "string" ? locked.replace(/\(.+$/, "") : undefined;
  if (!lockedVersion) {
    mismatches.push(`${name}: missing from the cloud-service lockfile importer`);
  } else if (runtimeVersion !== lockedVersion) {
    mismatches.push(`${name}: runtime ${runtimeVersion}, lockfile ${lockedVersion}`);
  }
}

if (mismatches.length) {
  console.error("[cloud:runtime-deps] Runtime container dependencies are stale:");
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exit(1);
}

console.log(
  `[cloud:runtime-deps] ${Object.keys(runtimeManifest.dependencies ?? {}).length} runtime dependencies match the audited lockfile.`,
);
