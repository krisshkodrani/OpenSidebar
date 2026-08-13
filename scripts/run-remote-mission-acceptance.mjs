#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runRemoteMissionAcceptance } from "./remote-mission-acceptance-lib.mjs";

const root = process.cwd();
const outputDirectory = resolve(root, ".artifacts", "e2e", "remote-mission");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = resolve(outputDirectory, `acceptance-${stamp}.json`);
const sessionPath = resolve(outputDirectory, "coordinator-session.json");
const coordinatorSession = existsSync(sessionPath)
  ? JSON.parse(readFileSync(sessionPath, "utf8"))
  : undefined;

try {
  const report = await runRemoteMissionAcceptance({
    linkCode: process.env.OPENSIDEBAR_ACCEPTANCE_LINK_CODE,
    coordinatorSession,
    onCoordinatorSession: (session) => {
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(sessionPath, `${JSON.stringify(session)}\n`, { encoding: "utf8", mode: 0o600 });
    },
    deviceName: process.env.OPENSIDEBAR_ACCEPTANCE_DEVICE?.trim() || undefined,
    origin: process.env.OPENSIDEBAR_CLOUD_ORIGIN?.trim() || undefined,
    timeoutMilliseconds: Number(
      process.env.OPENSIDEBAR_ACCEPTANCE_TIMEOUT_MS ?? 10 * 60_000,
    ),
    onProgress: (message) => console.log(`[remote-mission:acceptance] ${message}`),
  });
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[remote-mission:acceptance] ${report.result}: ${report.terminalState}`);
  console.log(`[remote-mission:acceptance] Wrote ${outputPath}`);
  process.exitCode = report.result === "passed" ? 0 : 1;
} catch (error) {
  console.error(
    `[remote-mission:acceptance] Failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
