/**
 * Export RL trajectories as a JSONL dataset (RFC LP-7, Stage B3). Reuses the
 * same store + projection the MCP server uses, so the exported data matches what
 * agents and the viewer see. Output lands under the git-ignored traces/ tree.
 *
 * Usage:
 *   pnpm run obs:export-trajectories -- [--outcome completed] [--limit 200] [--out <path>]
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { createDiskStore, getRlTrajectory, searchTraces, PROJECT_ROOT } from "./core";

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(): void {
  const store = createDiskStore();
  const outcome = flag("--outcome");
  const limit = Number(flag("--limit") ?? "200");
  const out =
    flag("--out") ?? join(PROJECT_ROOT, "traces", "obs", "trajectories.jsonl");

  const sessions = searchTraces(store, { outcome, limit });
  const lines: string[] = [];
  for (const session of sessions) {
    const trajectory = getRlTrajectory(store, session.sessionId);
    if (trajectory) lines.push(JSON.stringify(trajectory));
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf-8");
  console.log(`[obs] wrote ${lines.length} RL trajectories to ${out}`);
}

main();
