#!/usr/bin/env tsx

import {
  type ListResult,
  type TaskInfo,
  type WorkArenaFirstTaskCandidate,
  type WorkArenaFirstTaskReport,
  type WorkArenaSuite,
  readinessLabel,
  runWorkArenaBridge,
  runWorkArenaDoctor,
  safeFilePart,
  today,
  withReadiness,
  writeJsonReport,
} from "./workarena-adapter-lib.js";
import { validateWorkArenaReport } from "./workarena-report-schema.js";

function parseArgs(): {
  suite: WorkArenaSuite;
  category: string | null;
  seed: number;
  limit: number;
  json: boolean;
  noReport: boolean;
} {
  const args = process.argv.slice(2);
  const suiteArg = args[args.indexOf("--suite") + 1] as WorkArenaSuite | undefined;
  const categoryArg = args[args.indexOf("--category") + 1];
  const seedArg = Number.parseInt(args[args.indexOf("--seed") + 1] ?? "", 10);
  const limitArg = Number.parseInt(args[args.indexOf("--limit") + 1] ?? "", 10);
  return {
    suite:
      suiteArg && ["all", "atomic", "l1", "l2", "l3"].includes(suiteArg)
        ? suiteArg
        : "atomic",
    category: categoryArg && !categoryArg.startsWith("--") ? categoryArg : null,
    seed: Number.isFinite(seedArg) ? seedArg : 0,
    limit: Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 8,
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
  };
}

function listTasks(suite: WorkArenaSuite, category: string | null): ListResult {
  const bridgeArgs = ["list", "--suite", suite];
  if (category) bridgeArgs.push("--category", category);
  return runWorkArenaBridge<ListResult>(bridgeArgs, { timeoutMs: 120_000 });
}

function includesAny(value: string, terms: readonly string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function scoreTask(task: TaskInfo): { score: number; rationale: string[] } {
  const text = `${task.id} ${task.className} ${task.category ?? ""}`.toLowerCase();
  let score = 0;
  const rationale: string[] = [];

  if (task.kind === "atomic") {
    rationale.push("atomic task; preferred for first plumbing run");
  } else {
    score += 100;
    rationale.push("compositional task; higher first-run risk");
  }

  if (task.level) {
    score += 40;
    rationale.push(`${task.level} curriculum task; not ideal for first run`);
  }

  if (includesAny(text, ["all-menu", "menu", "navigation", "navigate"])) {
    score -= 25;
    rationale.push("navigation/menu-oriented task; likely low mutation risk");
  }
  if (includesAny(text, ["list", "filter", "sort", "search"])) {
    score -= 10;
    rationale.push("read/list-oriented task; useful for validating perception and navigation");
  }
  if (includesAny(text, ["knowledge", "article", "report"])) {
    score -= 5;
    rationale.push("document/knowledge task; usually less destructive than record mutation");
  }
  if (includesAny(text, ["create", "delete", "order", "request", "approve", "reject"])) {
    score += 35;
    rationale.push("record-changing task; keep for after handoff plumbing is proven");
  }
  if (includesAny(text, ["email", "message", "chat", "comment"])) {
    score += 25;
    rationale.push("communication task; avoid as first real run");
  }
  if (includesAny(text, ["update", "edit", "modify", "assign", "close"])) {
    score += 15;
    rationale.push("state mutation task; moderate validation risk");
  }

  if (rationale.length === 1) {
    rationale.push("no extra risk markers found in task metadata");
  }

  return { score, rationale };
}

function handoffCommand(taskId: string, seed: number): string {
  return `npm run benchmark:workarena:handoff -- --task ${taskId} --seed ${seed} --allow-servicenow-reset`;
}

function rankCandidates(
  tasks: readonly TaskInfo[],
  seed: number,
  limit: number,
): WorkArenaFirstTaskCandidate[] {
  return tasks
    .map((task) => {
      const scored = scoreTask(task);
      return {
        rank: 0,
        task,
        score: scored.score,
        rationale: scored.rationale,
        handoffCommand: handoffCommand(task.id, seed),
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return left.task.id.localeCompare(right.task.id);
    })
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function buildReport(args: ReturnType<typeof parseArgs>): WorkArenaFirstTaskReport {
  const doctor = withReadiness(runWorkArenaDoctor(false));
  const list = listTasks(args.suite, args.category);
  const candidates = rankCandidates(list.tasks, args.seed, args.limit);
  const readiness = doctor.readiness ?? "blocked";

  return {
    benchmark: "workarena",
    mode: "first-task",
    ready: doctor.ready,
    readiness,
    suite: args.suite,
    seed: args.seed,
    candidateCount: list.tasks.length,
    selected: candidates[0] ?? null,
    candidates,
    doctor: {
      ready: doctor.ready,
      readiness,
      checks: doctor.checks,
    },
    notes: [
      "This command is metadata-only and does not reset ServiceNow.",
      "Use the selected handoff command only after doctor.ready=true.",
      "Ranking is heuristic; it prefers atomic navigation/read tasks before mutation or communication tasks.",
    ],
  };
}

function writeReport(result: WorkArenaFirstTaskReport): string {
  const suffix = result.selected
    ? safeFilePart(result.selected.task.id)
    : safeFilePart(result.suite);
  return writeJsonReport(result, `workarena-first-task-${today()}-${suffix}.json`);
}

function printHuman(result: WorkArenaFirstTaskReport): void {
  console.log("\n[workarena:first-task] First WorkArena handoff candidate");
  console.log(`[workarena:first-task] Ready: ${result.ready ? "yes" : "no"}`);
  console.log(`[workarena:first-task] Setup: ${readinessLabel(result.readiness)}`);
  console.log(`[workarena:first-task] Suite: ${result.suite}`);
  console.log(`[workarena:first-task] Candidate pool: ${result.candidateCount}`);
  if (result.reportPath) {
    console.log(`[workarena:first-task] Report: ${result.reportPath}`);
  }
  console.log("");

  if (!result.selected) {
    console.log("[workarena:first-task] No candidate tasks found.");
    return;
  }

  console.log(
    `[workarena:first-task] Selected: ${result.selected.task.id} (score ${result.selected.score})`,
  );
  console.log(`[workarena:first-task] Command: ${result.selected.handoffCommand}`);
  console.log("");
  console.log("[workarena:first-task] Ranked candidates:");
  for (const candidate of result.candidates) {
    const category = candidate.task.category ?? "uncategorized";
    console.log(
      `[workarena:first-task]   ${candidate.rank}. ${candidate.task.id} | ${candidate.task.kind} | ${category} | score=${candidate.score}`,
    );
  }
}

function main(): void {
  const args = parseArgs();
  const result = buildReport(args);
  const errors = validateWorkArenaReport(result);
  if (errors.length > 0) {
    throw new Error(
      `generated first-task report failed schema validation: ${errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; ")}`,
    );
  }

  if (!args.noReport) {
    result.reportPath = writeReport(result);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
}

main();
