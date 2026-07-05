#!/usr/bin/env tsx
/**
 * RFC LP-11 perception-default A/B: run the full arena set under both
 * auto-mode defaults (structured vs unified_vl) on an identical executor
 * config, then emit a side-by-side comparison with the pre-registered
 * non-inferiority criterion evaluated.
 *
 * Usage:
 *   tsx scripts/run-perception-ab.ts [--repeat 2] [--no-build] [--tier <t>]
 *
 * Both arms inherit E2E_PROVIDER / E2E_MODEL from the environment (defaults
 * to the runtime default executor when unset). Reports land in
 * .artifacts/e2e/ as arena-score-<date>-arm-{structured,unified-vl}.{md,json}
 * plus perception-ab-<date>.md with the verdict.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), "..");
const REPORTS_DIR = resolve(PROJECT_ROOT, ".artifacts", "e2e");

// Pre-registered non-inferiority criterion (see the LP-11 plan/RFC): flip
// only if arm B (unified_vl default) is not worse than arm A by more than
// these margins. Registered here, before any measurement, to prevent
// post-hoc rationalization.
const OVERALL_MARGIN_PP = 5;
const TIER_MARGIN_PP = 10;
const IMAGE_ATTACHMENT_RATIO_MAX = 2;

type ArmName = "structured" | "unified_vl";

interface ArmRecord {
  taskId: string;
  tier: "easy" | "medium" | "hard";
  attempt: number;
  success: boolean;
  reason: string;
  durationMs: number;
  turns: number;
  perceptions: number;
  imageAttachments: number;
  inspectRegionCalls: number;
  screenshotTransforms: number;
}

interface ArmSummary {
  arm: ArmName;
  records: ArmRecord[];
  passRate: number;
  byTier: Record<string, { passed: number; total: number; rate: number }>;
  avgTurns: number;
  medianImages: number;
  avgDurationMs: number;
}

function parseArgs(): { repeat: number; build: boolean; extraArgs: string[] } {
  const args = process.argv.slice(2);
  let repeat = 2;
  const extraArgs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--repeat") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        repeat = value;
        index++;
      }
      continue;
    }
    if (arg === "--no-build") continue; // handled below
    if (arg === "--tier" || arg === "--tag") {
      extraArgs.push(arg, args[index + 1] ?? "");
      index++;
      continue;
    }
  }
  return { repeat, build: !args.includes("--no-build"), extraArgs };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(arm: ArmName, records: ArmRecord[]): ArmSummary {
  const byTier: ArmSummary["byTier"] = {};
  for (const record of records) {
    const entry = (byTier[record.tier] ??= { passed: 0, total: 0, rate: 0 });
    entry.total++;
    if (record.success) entry.passed++;
  }
  for (const entry of Object.values(byTier)) {
    entry.rate = entry.total > 0 ? entry.passed / entry.total : 0;
  }
  return {
    arm,
    records,
    passRate:
      records.length > 0
        ? records.filter((record) => record.success).length / records.length
        : 0,
    byTier,
    avgTurns: average(records.map((record) => record.turns)),
    medianImages: median(records.map((record) => record.imageAttachments)),
    avgDurationMs: average(records.map((record) => record.durationMs)),
  };
}

function runArm(
  arm: ArmName,
  repeat: number,
  build: boolean,
  extraArgs: string[],
): ArmSummary {
  const label = `arm-${arm.replace("_", "-")}`;
  const args = [
    "tsx",
    "scripts/run-e2e-arena.ts",
    "--all",
    "--repeat",
    String(repeat),
    "--perception-auto-default",
    arm,
    "--report-label",
    label,
    ...(build ? [] : ["--no-build"]),
    ...extraArgs,
  ];
  console.log(`\n[perception-ab] Running arm ${arm}: ${args.join(" ")}`);
  try {
    execSync(`corepack pnpm exec ${args.join(" ")}`, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {
    // Non-zero exit just means some attempts failed — the JSON has the data.
  }
  const today = new Date().toISOString().split("T")[0];
  const jsonPath = resolve(REPORTS_DIR, `arena-score-${today}-${label}.json`);
  if (!existsSync(jsonPath)) {
    throw new Error(`[perception-ab] Missing arm output: ${jsonPath}`);
  }
  const parsed = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
    records: ArmRecord[];
  };
  return summarize(arm, parsed.records);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildComparison(a: ArmSummary, b: ArmSummary): string {
  const date = new Date().toISOString().split("T")[0];
  const overallDeltaPp = (b.passRate - a.passRate) * 100;
  const tierBreaches: string[] = [];
  for (const [tier, aEntry] of Object.entries(a.byTier)) {
    const bEntry = b.byTier[tier];
    if (!bEntry) continue;
    const deltaPp = (bEntry.rate - aEntry.rate) * 100;
    if (deltaPp < -TIER_MARGIN_PP) {
      tierBreaches.push(`${tier}: ${deltaPp.toFixed(1)}pp`);
    }
  }
  const imageRatio =
    a.medianImages > 0 ? b.medianImages / a.medianImages : Infinity;
  const overallOk = overallDeltaPp >= -OVERALL_MARGIN_PP;
  const tiersOk = tierBreaches.length === 0;
  const imagesOk =
    b.medianImages === 0 || imageRatio <= IMAGE_ATTACHMENT_RATIO_MAX;
  const verdict = overallOk && tiersOk && imagesOk;

  const lines: string[] = [];
  lines.push("# LP-11 Perception Auto-Default A/B — Arena Comparison");
  lines.push("");
  lines.push(`Date: ${date}`);
  lines.push(`Executor model: \`${process.env.E2E_MODEL ?? "(runtime default)"}\``);
  lines.push("");
  lines.push("## Pre-registered criterion");
  lines.push("");
  lines.push(
    `Flip to unified_vl only if: overall success >= arm A - ${OVERALL_MARGIN_PP}pp; no tier worse by > ${TIER_MARGIN_PP}pp; median image attachments <= ${IMAGE_ATTACHMENT_RATIO_MAX}x arm A; e2e easy+medium green under arm B (run separately).`,
  );
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Metric | Arm A (structured) | Arm B (unified_vl) | Delta |");
  lines.push("| --- | ---: | ---: | ---: |");
  lines.push(
    `| Overall success | ${formatPercent(a.passRate)} | ${formatPercent(b.passRate)} | ${overallDeltaPp.toFixed(1)}pp |`,
  );
  for (const tier of ["easy", "medium", "hard"]) {
    const aEntry = a.byTier[tier];
    const bEntry = b.byTier[tier];
    if (!aEntry || !bEntry) continue;
    lines.push(
      `| ${tier} success | ${aEntry.passed}/${aEntry.total} (${formatPercent(aEntry.rate)}) | ${bEntry.passed}/${bEntry.total} (${formatPercent(bEntry.rate)}) | ${((bEntry.rate - aEntry.rate) * 100).toFixed(1)}pp |`,
    );
  }
  lines.push(
    `| Avg turns | ${a.avgTurns.toFixed(1)} | ${b.avgTurns.toFixed(1)} | ${(b.avgTurns - a.avgTurns).toFixed(1)} |`,
  );
  lines.push(
    `| Median images/run | ${a.medianImages} | ${b.medianImages} | x${a.medianImages > 0 ? imageRatio.toFixed(2) : "n/a"} |`,
  );
  lines.push(
    `| Avg duration | ${Math.round(a.avgDurationMs / 1000)}s | ${Math.round(b.avgDurationMs / 1000)}s | ${Math.round((b.avgDurationMs - a.avgDurationMs) / 1000)}s |`,
  );
  lines.push("");
  lines.push("## Per-task pass counts");
  lines.push("");
  lines.push("| Task | Tier | Arm A | Arm B |");
  lines.push("| --- | --- | ---: | ---: |");
  const taskIds = [
    ...new Set([...a.records, ...b.records].map((record) => record.taskId)),
  ].sort();
  for (const taskId of taskIds) {
    const aGroup = a.records.filter((record) => record.taskId === taskId);
    const bGroup = b.records.filter((record) => record.taskId === taskId);
    const tier = (aGroup[0] ?? bGroup[0])?.tier ?? "?";
    lines.push(
      `| \`${taskId}\` | ${tier} | ${aGroup.filter((r) => r.success).length}/${aGroup.length} | ${bGroup.filter((r) => r.success).length}/${bGroup.length} |`,
    );
  }
  lines.push("");
  lines.push("## Verdict (arena portion)");
  lines.push("");
  lines.push(`- Overall non-inferiority: ${overallOk ? "PASS" : "FAIL"} (${overallDeltaPp.toFixed(1)}pp vs -${OVERALL_MARGIN_PP}pp margin)`);
  lines.push(
    `- Tier non-inferiority: ${tiersOk ? "PASS" : `FAIL (${tierBreaches.join("; ")})`}`,
  );
  lines.push(
    `- Image economics: ${imagesOk ? "PASS" : "FAIL"} (median x${a.medianImages > 0 ? imageRatio.toFixed(2) : "n/a"} vs x${IMAGE_ATTACHMENT_RATIO_MAX} cap)`,
  );
  lines.push("");
  lines.push(
    `**Arena verdict: ${verdict ? "NON-INFERIOR — flip supported" : "INFERIOR — keep structured default"}** (staged-suite evidence under arm B still required before the flip).`,
  );
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const { repeat, build, extraArgs } = parseArgs();
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

  // Build once up front; both arms then run --no-build on identical bits.
  if (build) {
    console.log("[perception-ab] Building e2e extension + fixtures once...");
    execSync("corepack pnpm run build:e2e", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    execSync("corepack pnpm run fixtures:build", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
  }

  const armA = runArm("structured", repeat, false, extraArgs);
  const armB = runArm("unified_vl", repeat, false, extraArgs);

  const comparison = buildComparison(armA, armB);
  const today = new Date().toISOString().split("T")[0];
  const outPath = resolve(REPORTS_DIR, `perception-ab-${today}.md`);
  writeFileSync(outPath, comparison, "utf-8");
  console.log(`\n[perception-ab] Comparison written to ${outPath}`);
  console.log(comparison);
}

main();
