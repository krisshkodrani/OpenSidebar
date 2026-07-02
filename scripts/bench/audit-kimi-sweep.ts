#!/usr/bin/env tsx

import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";
import { fileURLToPath } from "url";
import { aggregateResults } from "./aggregate";
import type {
  BenchAggregate,
  BenchJudgeOutcome,
  BenchTaskResult,
} from "./types";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_RUN_DIR = resolve(
  PROJECT_ROOT,
  ".artifacts/bench/kimi-k2p7-sweep-36",
);

type RunKey = "k2p6" | "k2p7-code";

interface VerdictCorrection {
  run: RunKey;
  taskId: string;
  from: BenchJudgeOutcome;
  to: BenchJudgeOutcome;
  confidence: number;
  reason: string;
  receiptEvidence: string;
}

interface AppliedVerdictCorrection extends VerdictCorrection {
  task: string;
  originalReasoning: string;
}

interface AuditedRun {
  label: string;
  raw: BenchAggregate;
  audited: BenchAggregate;
  corrections: AppliedVerdictCorrection[];
}

const CORRECTIONS: readonly VerdictCorrection[] = [
  {
    run: "k2p6",
    taskId: "2207bb4f21786690cfed20b37253fb8b",
    from: "failure",
    to: "success",
    confidence: 1,
    reason:
      'The post-navigation turn received rendered Calgary page context showing "Wind: 15 km/h", which directly supports the final answer.',
    receiptEvidence:
      "Raw turn-seven snapshot context and model response on The Weather Network Calgary page.",
  },
  {
    run: "k2p6",
    taskId: "6b2cfae0ef25c73d1224b6ab74cb8b63",
    from: "failure",
    to: "success",
    confidence: 0.99,
    reason:
      "Receipt audit found read_page output containing both 33.7 PPG and the 2022-23 playoff season, matching the final answer.",
    receiptEvidence:
      "Raw trace read_page output on Devin Booker's playoff statistics page.",
  },
  {
    run: "k2p7-code",
    taskId: "sample-hn-top-story",
    from: "failure",
    to: "success",
    confidence: 0.99,
    reason:
      "The judge prompt states that a turn-one done call at the start URL is grounded by the harness-injected initial page content. The identical title and execution pattern passed for K2.6.",
    receiptEvidence:
      "Initial rendered Hacker News page context plus the judge's own turn-one grounding rule.",
  },
  {
    run: "k2p7-code",
    taskId: "5e4e89c9b6fdaee7a41aca5601b82e04",
    from: "failure",
    to: "success",
    confidence: 1,
    reason:
      'Receipt audit found explicit read_page output: pill imprint "894 5" was identified as Eliquis 5 mg, generic apixaban, matching the final answer.',
    receiptEvidence:
      "Raw trace read_page output from https://www.drugs.com/imprints/894-5-20369.html.",
  },
  {
    run: "k2p7-code",
    taskId: "bd1e3770b7181f6fce9c35e18caa9785",
    from: "success",
    to: "failure",
    confidence: 1,
    reason:
      'The final Craigslist result explicitly said "no results found." The duplicate filter was active, but the task also required browsing service listings, so the literal objective was not completed.',
    receiptEvidence:
      'Raw trace read_page output containing "no results found."',
  },
  {
    run: "k2p7-code",
    taskId: "e4e19e04286f644d747d8c5a79d17fac",
    from: "failure",
    to: "success",
    confidence: 1,
    reason:
      'Receipt audit found read_page output titled "Drug Interaction Report: Alcohol (contained in alcoholic beverages), Viagra", with the exact combined report URL.',
    receiptEvidence:
      "Raw turn-22 read_page output from the Viagra and alcohol Drugs.com interaction report.",
  },
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyCorrections(
  run: RunKey,
  results: BenchTaskResult[],
): {
  results: BenchTaskResult[];
  corrections: AppliedVerdictCorrection[];
} {
  const applicable = CORRECTIONS.filter((correction) => correction.run === run);
  const applied: AppliedVerdictCorrection[] = [];
  const correctedResults = results.map((result) => {
    const taskId = result.evidence.task.task_id;
    const correction = applicable.find((item) => item.taskId === taskId);
    if (!correction) return result;

    if (!result.verdict) {
      throw new Error(`${run}/${taskId} has no verdict to audit.`);
    }
    if (result.verdict.outcome !== correction.from) {
      throw new Error(
        `${run}/${taskId} expected ${correction.from}, found ${result.verdict.outcome}.`,
      );
    }

    applied.push({
      ...correction,
      task: result.evidence.task.confirmed_task,
      originalReasoning: result.verdict.reasoning,
    });
    return {
      ...result,
      verdict: {
        ...result.verdict,
        outcome: correction.to,
        confidence: correction.confidence,
        reasoning: `Manual receipt audit: ${correction.reason}`,
        judgeModel: "manual-receipt-audit-v1",
      },
    };
  });

  const missing = applicable.filter(
    (correction) =>
      !applied.some((item) => item.taskId === correction.taskId),
  );
  if (missing.length > 0) {
    throw new Error(
      `${run} is missing expected correction task(s): ${missing
        .map((item) => item.taskId)
        .join(", ")}`,
    );
  }

  return { results: correctedResults, corrections: applied };
}

function buildRunAudit(
  runDir: string,
  run: RunKey,
  label: string,
): AuditedRun {
  const modelDir = join(runDir, run);
  const resultsPath = join(modelDir, "results.json");
  if (!existsSync(resultsPath)) {
    throw new Error(`Missing ${resultsPath}`);
  }

  const rawResults = readJson<BenchTaskResult[]>(resultsPath);
  const raw = aggregateResults(rawResults);
  const corrected = applyCorrections(run, rawResults);
  const audited = aggregateResults(corrected.results);

  writeJson(join(modelDir, "results.audited.json"), corrected.results);
  writeJson(join(modelDir, "summary.audited.json"), audited);

  return {
    label,
    raw,
    audited,
    corrections: corrected.corrections,
  };
}

function formatComparisonMarkdown(
  baseline: AuditedRun,
  candidate: AuditedRun,
): string {
  const lines = [
    "# Kimi K2.6 vs K2.7 Receipt-Audited Sweep",
    "",
    "> Original WebJudge files are preserved. Six verdicts were changed only after checking raw trace receipts.",
    "",
    "## Overall results",
    "",
    "| Config | WebJudge | Receipt-audited | Net change |",
    "| --- | ---: | ---: | ---: |",
    `| ${baseline.label} | ${pct(baseline.raw.passRate)} (${baseline.raw.successes}/${baseline.raw.scored}) | ${pct(baseline.audited.passRate)} (${baseline.audited.successes}/${baseline.audited.scored}) | +${baseline.audited.successes - baseline.raw.successes} success |`,
    `| ${candidate.label} | ${pct(candidate.raw.passRate)} (${candidate.raw.successes}/${candidate.raw.scored}) | ${pct(candidate.audited.passRate)} (${candidate.audited.successes}/${candidate.audited.scored}) | +${candidate.audited.successes - candidate.raw.successes} net success |`,
    "",
    "## Audited results by difficulty",
    "",
    "| Level | K2.6 | K2.7 Code |",
    "| --- | ---: | ---: |",
    ...(["easy", "medium", "hard"] as const).map(
      (level) =>
        `| ${level} | ${baseline.audited.byLevel[level].successes}/${baseline.audited.byLevel[level].total} (${pct(baseline.audited.byLevel[level].passRate)}) | ${candidate.audited.byLevel[level].successes}/${candidate.audited.byLevel[level].total} (${pct(candidate.audited.byLevel[level].passRate)}) |`,
    ),
    "",
    "## Verdict corrections",
    "",
    "| Model | Task | Change | Audit basis |",
    "| --- | --- | --- | --- |",
    ...[...baseline.corrections, ...candidate.corrections].map(
      (correction) =>
        `| ${correction.run === "k2p6" ? "K2.6" : "K2.7 Code"} | ${correction.task} | ${correction.from} -> ${correction.to} | ${correction.reason} |`,
    ),
    "",
    "## Caveats",
    "",
    "- K2.7 is missing the Rotten Tomatoes Easy task, which K2.6 passed.",
    "- The arXiv K2.7 title omitted the word `Space`; its success verdict remains unchanged because that wording discrepancy is borderline rather than a clear task failure.",
    "- This audit corrects scoring errors; it does not repair runtime completion statuses such as `partial` or `failed`.",
    "",
  ];
  return lines.join("\n");
}

function svgText(
  x: number,
  y: number,
  text: string,
  options: {
    size?: number;
    weight?: number;
    fill?: string;
    anchor?: "start" | "middle" | "end";
  } = {},
): string {
  return `<text x="${x}" y="${y}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${options.size ?? 20}" font-weight="${options.weight ?? 400}" fill="${options.fill ?? "#172033"}" text-anchor="${options.anchor ?? "start"}">${escapeXml(text)}</text>`;
}

function buildChartSvg(
  baseline: AuditedRun,
  candidate: AuditedRun,
): string {
  const width = 1200;
  const height = 720;
  const chartTop = 190;
  const chartBottom = 560;
  const chartHeight = chartBottom - chartTop;
  const maxRate = 0.5;
  const barWidth = 150;
  const baselineX = 250;
  const candidateX = 700;
  const colors = {
    raw: "#cbd5e1",
    baseline: "#2563eb",
    candidate: "#7c3aed",
    grid: "#dbe3ef",
  };
  const bars = [
    {
      x: baselineX,
      label: "K2.6",
      raw: baseline.raw.passRate,
      audited: baseline.audited.passRate,
      color: colors.baseline,
      score: `${baseline.audited.successes}/${baseline.audited.scored}`,
    },
    {
      x: candidateX,
      label: "K2.7 Code",
      raw: candidate.raw.passRate,
      audited: candidate.audited.passRate,
      color: colors.candidate,
      score: `${candidate.audited.successes}/${candidate.audited.scored}`,
    },
  ];
  const yFor = (rate: number) =>
    chartBottom - Math.min(rate / maxRate, 1) * chartHeight;

  const elements: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="1200" height="720" fill="#f8fafc"/>',
    '<rect x="36" y="32" width="1128" height="656" rx="24" fill="#ffffff" stroke="#e2e8f0"/>',
    svgText(80, 88, "Kimi K2.6 vs K2.7: Receipt-Audited Results", {
      size: 32,
      weight: 700,
    }),
    svgText(
      80,
      124,
      "Online-Mind2Web sweep | raw WebJudge verdicts compared with six receipt-backed corrections",
      { size: 17, fill: "#64748b" },
    ),
    '<rect x="790" y="74" width="18" height="18" rx="4" fill="#cbd5e1"/>',
    svgText(818, 89, "WebJudge", { size: 15, fill: "#475569" }),
    '<path d="M924 74h5v18h-5a4 4 0 0 1-4-4V78a4 4 0 0 1 4-4Z" fill="#2563eb"/>',
    '<path d="M929 74h5a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-5Z" fill="#7c3aed"/>',
    svgText(948, 89, "Receipt-audited", { size: 15, fill: "#475569" }),
  ];

  for (let value = 0; value <= 0.5; value += 0.1) {
    const y = yFor(value);
    elements.push(
      `<line x1="150" y1="${y}" x2="1060" y2="${y}" stroke="${colors.grid}" stroke-width="1"/>`,
      svgText(132, y + 6, `${Math.round(value * 100)}%`, {
        size: 15,
        fill: "#64748b",
        anchor: "end",
      }),
    );
  }

  for (const bar of bars) {
    const rawX = bar.x;
    const auditedX = bar.x + barWidth + 26;
    const rawY = yFor(bar.raw);
    const auditedY = yFor(bar.audited);
    elements.push(
      `<rect x="${rawX}" y="${rawY}" width="${barWidth}" height="${chartBottom - rawY}" rx="10" fill="${colors.raw}"/>`,
      `<rect x="${auditedX}" y="${auditedY}" width="${barWidth}" height="${chartBottom - auditedY}" rx="10" fill="${bar.color}"/>`,
      svgText(rawX + barWidth / 2, rawY - 14, pct(bar.raw), {
        size: 20,
        weight: 700,
        fill: "#64748b",
        anchor: "middle",
      }),
      svgText(auditedX + barWidth / 2, auditedY - 14, pct(bar.audited), {
        size: 22,
        weight: 700,
        fill: bar.color,
        anchor: "middle",
      }),
      svgText(bar.x + barWidth + 13, 606, bar.label, {
        size: 22,
        weight: 700,
        anchor: "middle",
      }),
      svgText(bar.x + barWidth + 13, 634, `Audited: ${bar.score}`, {
        size: 16,
        fill: "#64748b",
        anchor: "middle",
      }),
    );
  }

  elements.push(
    '<line x1="80" y1="650" x2="1120" y2="650" stroke="#e2e8f0"/>',
    svgText(
      80,
      674,
      "Corrections: K2.6 +2; K2.7 +3 false negatives and -1 false positive. Raw judge artifacts remain unchanged.",
      { size: 14, fill: "#64748b" },
    ),
    "</svg>",
  );
  return elements.join("\n");
}

function main(): void {
  const runDirIndex = process.argv.indexOf("--run-dir");
  const runDir =
    runDirIndex >= 0 && process.argv[runDirIndex + 1]
      ? resolve(process.cwd(), process.argv[runDirIndex + 1])
      : DEFAULT_RUN_DIR;
  if (!existsSync(runDir)) {
    throw new Error(`Run directory does not exist: ${runDir}`);
  }

  const baseline = buildRunAudit(runDir, "k2p6", "K2.6 baseline");
  const candidate = buildRunAudit(
    runDir,
    "k2p7-code",
    "K2.7 Code candidate",
  );
  const corrections = [...baseline.corrections, ...candidate.corrections];
  if (corrections.length !== CORRECTIONS.length) {
    throw new Error(
      `Expected ${CORRECTIONS.length} corrections, applied ${corrections.length}.`,
    );
  }

  const audit = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRunDir: basename(runDir),
    policy:
      "Only clear receipt-backed judge errors are changed. Raw WebJudge artifacts remain untouched.",
    baseline,
    candidate,
    corrections,
  };
  writeJson(join(runDir, "comparison.audited.json"), audit);
  writeFileSync(
    join(runDir, "comparison.audited.md"),
    formatComparisonMarkdown(baseline, candidate),
    "utf-8",
  );
  writeFileSync(
    join(runDir, "comparison.audited.svg"),
    buildChartSvg(baseline, candidate),
    "utf-8",
  );

  console.log(`Audited K2.6: ${pct(baseline.audited.passRate)}`);
  console.log(`Audited K2.7: ${pct(candidate.audited.passRate)}`);
  console.log(`Wrote audited artifacts to ${runDir}`);
}

main();
