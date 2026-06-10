#!/usr/bin/env tsx
/**
 * Fetch the official Online-Mind2Web task list into a vendored, pinned file
 * (RFC LP-1). The dataset is access-gated on Hugging Face, so this requires:
 *
 *   1. Accept the dataset terms at
 *      https://huggingface.co/datasets/osunlp/Online-Mind2Web
 *   2. Export a token:  export HF_TOKEN=hf_xxx   (read access is enough)
 *   3. Run:  pnpm tsx scripts/bench/fetch-tasks.ts [--revision <sha|tag>]
 *
 * Output: scripts/bench/tasks/online-mind2web.json (BenchTaskFile shape), with
 * the dataset revision pinned for reproducibility. The runner prefers this file
 * over the bundled sample when it exists.
 *
 * This script normalizes the upstream rows to the BenchTask schema. If the
 * upstream field names change, adjust `normalizeRow` — it is the only
 * dataset-shape assumption.
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { validateTaskFile } from "./loader";
import type { BenchDifficulty, BenchTask, BenchTaskFile } from "./types";

const DATASET = "osunlp/Online-Mind2Web";
const LICENSE = "CC-BY-4.0";
const CANDIDATE_FILES = [
  "Online_Mind2Web.json",
  "online_mind2web.json",
  "data/Online_Mind2Web.json",
];

function parseArgs(): { revision: string; out: string } {
  const args = process.argv.slice(2);
  const revIndex = args.indexOf("--revision");
  const revision = revIndex >= 0 ? args[revIndex + 1] : "main";
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "tasks", "online-mind2web.json");
  return { revision, out };
}

function normalizeLevel(value: unknown): BenchDifficulty {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("easy")) return "easy";
  if (text.includes("hard")) return "hard";
  return "medium";
}

function normalizeRow(row: Record<string, unknown>, index: number): BenchTask {
  const taskId = String(
    row.task_id ?? row.id ?? row.task_uid ?? `om2w-${index}`,
  );
  const confirmedTask = String(
    row.confirmed_task ?? row.task ?? row.instruction ?? "",
  );
  const website = String(row.website ?? row.url ?? row.start_url ?? "");
  const task: BenchTask = {
    task_id: taskId,
    confirmed_task: confirmedTask,
    website,
    level: normalizeLevel(row.level ?? row.difficulty),
  };
  if (typeof row.reference_length === "number") {
    task.reference_length = row.reference_length;
  }
  return task;
}

async function fetchFirstAvailable(
  revision: string,
  token: string,
): Promise<unknown[]> {
  const errors: string[] = [];
  for (const file of CANDIDATE_FILES) {
    const url = `https://huggingface.co/datasets/${DATASET}/resolve/${revision}/${file}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        errors.push(`${file}: HTTP ${response.status}`);
        continue;
      }
      const json = (await response.json()) as unknown;
      if (Array.isArray(json)) return json;
      if (json && typeof json === "object" && Array.isArray((json as any).data)) {
        return (json as any).data as unknown[];
      }
      errors.push(`${file}: unexpected shape`);
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `Could not fetch a task file from ${DATASET}@${revision}. Tried:\n  ${errors.join("\n  ")}`,
  );
}

async function main(): Promise<void> {
  const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
  if (!token) {
    console.error(
      "[bench:fetch] HF_TOKEN is not set. Accept the dataset terms at\n" +
        `  https://huggingface.co/datasets/${DATASET}\n` +
        "then: export HF_TOKEN=hf_xxx",
    );
    process.exit(1);
  }
  const { revision, out } = parseArgs();
  console.log(`[bench:fetch] Fetching ${DATASET}@${revision} …`);
  const rows = await fetchFirstAvailable(revision, token);
  const tasks = rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map(normalizeRow)
    .filter((task) => task.confirmed_task && /^https?:\/\//i.test(task.website));

  const file: BenchTaskFile = {
    source: DATASET,
    revision,
    license: LICENSE,
    note: `Fetched ${new Date().toISOString()} from Hugging Face. Normalized to BenchTask schema.`,
    tasks,
  };
  // Validate before writing so a malformed fetch fails loudly.
  validateTaskFile(file);
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  console.log(`[bench:fetch] Wrote ${tasks.length} tasks → ${out}`);
}

main().catch((error) => {
  console.error("[bench:fetch] Fatal:", error);
  process.exit(1);
});
