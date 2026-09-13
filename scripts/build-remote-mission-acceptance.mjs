#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const result = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules", "tsx", "dist", "cli.mjs"),
    resolve(root, "scripts", "vite-clean.ts"),
    "build",
    "--mode",
    "remote-mission-acceptance",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      OPENSIDEBAR_REMOTE_MISSION_ACCEPTANCE: "true",
      VITE_CLOUD_SESSIONS_ENABLED: "true",
      VITE_REMOTE_MISSIONS_ENABLED: "true",
      VITE_REMOTE_MISSION_DIAGNOSTICS_ENABLED: "true",
    },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);

writeFileSync(
  resolve(root, "dist", ".remote-mission-acceptance.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      profile: "remote-mission-acceptance",
      cloudSessions: true,
      remoteMissions: true,
      releaseEligible: false,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(
  "[remote-mission:build] Acceptance-only dist/ is ready. It is not release eligible.",
);
