#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const markerPath = resolve(dist, ".remote-mission-acceptance.json");
const manifestPath = resolve(dist, "manifest.json");
const errors = [];

const readJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

if (!existsSync(markerPath)) errors.push("acceptance marker is missing");
if (!existsSync(manifestPath)) errors.push("extension manifest is missing");
const marker = existsSync(markerPath) ? readJson(markerPath, "acceptance marker") : null;
const manifest = existsSync(manifestPath) ? readJson(manifestPath, "manifest") : null;
if (marker?.profile !== "remote-mission-acceptance")
  errors.push("acceptance marker has the wrong profile");
if (marker?.cloudSessions !== true || marker?.remoteMissions !== true)
  errors.push("acceptance marker does not enable both required client flags");
if (marker?.releaseEligible !== false)
  errors.push("acceptance marker must explicitly reject release eligibility");
if (manifest?.name !== "OpenSidebar (remote acceptance)")
  errors.push("manifest is not visibly labeled as a remote acceptance build");
if (existsSync(resolve(dist, "src", "trace-viewer")))
  errors.push("acceptance build must remain production-shaped without the trace viewer");

const builtSource = existsSync(resolve(dist, "assets"))
  ? readdirSync(resolve(dist, "assets"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(resolve(dist, "assets", name), "utf8"))
      .join("\n")
  : "";
for (const expected of [
  "opensidebar:remote-mission-poll",
  "/remote-missions?",
  "/transition",
  "REMOTE_MISSION_CANCEL",
  "REMOTE_MISSION_DENY",
  "Requested task",
]) {
  if (!builtSource.includes(expected))
    errors.push(`built runtime marker is missing: ${expected}`);
}

if (errors.length) {
  console.error("[remote-mission:dist] Acceptance dist verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("[remote-mission:dist] Acceptance-only dist verification passed.");
