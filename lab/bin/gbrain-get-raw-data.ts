import { applyLabEnvironment } from "./common.js";

const slug = process.argv[2];
const source = process.argv[3];

if (!slug) {
  console.error("Usage: npx tsx lab/bin/gbrain-get-raw-data.ts <slug> [source]");
  process.exit(1);
}

applyLabEnvironment();

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
  const rows = await engine.getRawData(slug, source);
  process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
} finally {
  await engine.disconnect();
}
