/** Pick a sealed analytics snapshot only while its canonical source is unchanged. */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readParquetSnapshotManifest } from "./duck";

export interface CurrentAnalyticsSnapshot {
  dir: string;
  startedAtMs: number;
}

function hasNewerSource(path: string, snapshotStartedAtMs: number): boolean {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return true;
  if (stat.mtimeMs >= snapshotStartedAtMs) return true;
  if (!stat.isDirectory()) return false;
  for (const child of readdirSync(path)) {
    if (hasNewerSource(join(path, child), snapshotStartedAtMs)) return true;
  }
  return false;
}

export function currentAnalyticsSnapshot(
  projectRoot: string,
  spanDir: string,
  explicitDir?: string,
): CurrentAnalyticsSnapshot | null {
  if (!existsSync(spanDir)) return null;
  const base = join(projectRoot, ".artifacts", "obs", "parquet");
  const candidates = explicitDir ? [resolve(projectRoot, explicitDir)] :
    existsSync(base) ? readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("snapshot-"))
      .map((entry) => join(base, entry.name)).sort().reverse() : [];
  for (const dir of candidates) {
    try {
      const manifest = readParquetSnapshotManifest(dir);
      if (manifest.formatVersion !== 5) continue;
      if (hasNewerSource(spanDir, manifest.startedAtMs)) return null;
      return { dir, startedAtMs: manifest.startedAtMs };
    } catch {
      continue;
    }
  }
  return null;
}
