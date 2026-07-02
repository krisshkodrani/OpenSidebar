import { cpSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { loadTaskFile, selectStratifiedSubset } from "./loader";
import { fileURLToPath } from "url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const sampleTasks = loadTaskFile(resolve(PROJECT_ROOT, "scripts/bench/tasks/sample.json")).tasks;
const allTasks = loadTaskFile(resolve(PROJECT_ROOT, "scripts/bench/tasks/online-mind2web.json")).tasks;
const subset30 = selectStratifiedSubset(allTasks, { size: 30, seed: 0 });

const combinedTasks = [...sampleTasks, ...subset30];

const combinedTaskFile = {
  source: "osunlp/Online-Mind2Web + smoke",
  revision: "main",
  license: "CC-BY-4.0",
  note: "6 smoke tasks combined with 30 stratified subset tasks",
  tasks: combinedTasks
};

writeFileSync(resolve(PROJECT_ROOT, "scripts/bench/tasks/combined-36.json"), JSON.stringify(combinedTaskFile, null, 2));
console.log("Created combined-36.json with", combinedTasks.length, "tasks.");

const oldRunDir = resolve(PROJECT_ROOT, ".artifacts/bench/kimi-k2p7-smoke-2026-06-15T10-58-02-389Z");
const newRunDir = resolve(PROJECT_ROOT, ".artifacts/bench/kimi-k2p7-sweep-36");

mkdirSync(newRunDir, { recursive: true });

// Copy probe
cpSync(join(oldRunDir, "probe.json"), join(newRunDir, "probe.json"));

// Copy completed tasks and receipts
for (const model of ["k2p6", "k2p7-code"]) {
  const modelDir = join(newRunDir, model);
  mkdirSync(modelDir, { recursive: true });
  cpSync(join(oldRunDir, model, "tasks"), join(modelDir, "tasks"), { recursive: true });
  cpSync(join(oldRunDir, model, "receipts"), join(modelDir, "receipts"), { recursive: true });
}

console.log("Copied 6 completed tasks into new run directory:", newRunDir);
