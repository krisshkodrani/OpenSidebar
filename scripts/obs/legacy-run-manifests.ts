import { existsSync, readFileSync } from "fs";
import { join } from "path";

/** Latest manifest per run, matching the upserted SQLite lens. */
export function readLegacyRunManifests(
  runDir: string,
): Map<string, Record<string, unknown>> {
  const manifests = new Map<string, Record<string, unknown>>();
  const index = join(runDir, "index.jsonl");
  if (!existsSync(index)) return manifests;
  for (const line of readFileSync(index, "utf-8").split(/\r?\n/)) {
    if (!line) continue;
    try {
      const manifest = JSON.parse(line) as Record<string, unknown>;
      if (typeof manifest.runId === "string" && manifest.runId)
        manifests.set(manifest.runId, manifest);
    } catch { /* preserve other records */ }
  }
  return manifests;
}
