import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it } from "vitest";
import { readLegacyRunManifests } from "./legacy-run-manifests";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

it("keeps the latest valid manifest for each run", () => {
  const dir = mkdtempSync(join(tmpdir(), "obs-run-manifests-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.jsonl"), [
    JSON.stringify({ runId: "r1", status: "started" }),
    "{bad json",
    JSON.stringify({ runId: "r2", status: "completed" }),
    JSON.stringify({ runId: "r1", status: "completed" }),
  ].join("\n"));
  expect([...readLegacyRunManifests(dir).values()]).toEqual([
    { runId: "r1", status: "completed" },
    { runId: "r2", status: "completed" },
  ]);
});
