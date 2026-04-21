import { existsSync, readFileSync } from "fs";
import { applyLabEnvironment } from "./common.js";

interface ProjectionManifest {
  sessions?: Array<{
    slug: string;
    timelineEntries?: Array<{
      date: string;
      source: string;
      summary: string;
      detail: string;
    }>;
    rawData: Record<string, unknown>;
  }>;
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Usage: npx tsx lab/bin/enrich-trace-raw-data.ts <manifest-path>");
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}

applyLabEnvironment();

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as ProjectionManifest;
const sessions = manifest.sessions ?? [];
if (sessions.length === 0) {
  console.log("No sessions found for raw-data enrichment.");
  process.exit(0);
}

const { loadConfig, toEngineConfig } = await import("../agents/gbrain/repo/src/core/config.ts");
const { createEngine } = await import("../agents/gbrain/repo/src/core/engine-factory.ts");

const config = loadConfig();
if (!config) {
  console.error("No GBrain config found. Run lab:doctor or initialize the lab brain first.");
  process.exit(1);
}

const engineConfig = toEngineConfig(config);
const engine = await createEngine(engineConfig);
await engine.connect(engineConfig);

try {
  for (const session of sessions) {
    await engine.transaction(async (tx) => {
      await tx.putRawData(session.slug, "trace-session-json", session.rawData);
      await tx.deleteTimelineEntriesBySourcePrefix(session.slug, "trace-turn:");
      for (const entry of session.timelineEntries ?? []) {
        await tx.addTimelineEntry(session.slug, entry);
      }
    });
  }
} finally {
  await engine.disconnect();
}

console.log(`Enriched ${sessions.length} trace page(s) with raw_data and timeline entries.`);
