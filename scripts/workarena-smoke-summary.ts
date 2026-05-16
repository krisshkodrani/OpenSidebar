#!/usr/bin/env tsx

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  PROJECT_ROOT,
  REPORTS_DIR,
  safeFilePart,
  today,
} from "./workarena-adapter-lib.js";
import { validateWorkArenaReport } from "./workarena-report-schema.js";

type JsonRecord = Record<string, unknown>;

export type WorkArenaSmokeFixLayer =
  | "approval required"
  | "harness/session/validation"
  | "perception/page-state"
  | "tool/runtime"
  | "planner/skill policy"
  | "trace/report instrumentation"
  | "no immediate fix";

export interface WorkArenaSmokeSummary {
  sourceFile: string;
  taskId: string;
  seed: number | null;
  promptSource: string;
  validationPassed: boolean | null;
  score: number | null;
  terminalReason: string | null;
  failureClass: string;
  traceIds: string[];
  traceFiles: string[];
  runIds: string[];
  runTraceFiles: string[];
  turns: number | null;
  perceptions: number | null;
  tokens: number | null;
  costUsd: number | null;
  diagnostics: string[];
  primaryEvidence: string;
  nextFixLayer: WorkArenaSmokeFixLayer;
  recommendedAction: string;
  featureListItem: string;
}

interface Args {
  file: string | null;
  output: string | null;
  json: boolean;
  noReport: boolean;
}

interface TraceMetrics {
  turns: number;
  perceptions: number;
  runIds: string[];
  runTraceFiles: string[];
  missingTraceFiles: string[];
  toolFailures: string[];
  zeroElementTurns: number;
  replanEvents: number;
}

function parseArgs(argv = process.argv.slice(2)): Args {
  let file: string | null = null;
  let output: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        file = next;
        index += 1;
      }
      continue;
    }
    if (arg === "--output") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        output = next;
        index += 1;
      }
      continue;
    }
    if (!arg.startsWith("--")) file = arg;
  }
  return {
    file,
    output,
    json: argv.includes("--json"),
    noReport: argv.includes("--no-report"),
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(record: JsonRecord | null | undefined, key: string): JsonRecord | null {
  if (!record) return null;
  return isRecord(record[key]) ? (record[key] as JsonRecord) : null;
}

function stringValue(record: JsonRecord | null | undefined, key: string): string | null {
  if (!record) return null;
  return typeof record[key] === "string" ? record[key] : null;
}

function numberValue(record: JsonRecord | null | undefined, key: string): number | null {
  if (!record) return null;
  return typeof record[key] === "number" && Number.isFinite(record[key])
    ? record[key]
    : null;
}

function booleanValue(record: JsonRecord | null | undefined, key: string): boolean | null {
  if (!record) return null;
  return typeof record[key] === "boolean" ? record[key] : null;
}

function stringArray(record: JsonRecord | null | undefined, key: string): string[] {
  if (!record || !Array.isArray(record[key])) return [];
  return record[key].filter((value): value is string => typeof value === "string");
}

function resolveInputPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(PROJECT_ROOT, filePath);
}

function discoverLatestExecutionReport(): string | null {
  if (!existsSync(REPORTS_DIR)) return null;
  const candidates = readdirSync(REPORTS_DIR)
    .filter((name) => /^workarena-handoff-.*\.json$/i.test(name))
    .map((name) => {
      const filePath = join(REPORTS_DIR, name);
      return { filePath, mtimeMs: statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function parseTraceFile(filePath: string): {
  turns: number;
  perceptions: number;
  runIds: string[];
  toolFailures: string[];
  zeroElementTurns: number;
  replanEvents: number;
} {
  const result = {
    turns: 0,
    perceptions: 0,
    runIds: [] as string[],
    toolFailures: [] as string[],
    zeroElementTurns: 0,
    replanEvents: 0,
  };
  const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
  for (const line of lines) {
    let entry: JsonRecord;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      entry = parsed;
    } catch {
      continue;
    }
    result.turns += 1;
    const runId = stringValue(entry, "runId");
    if (runId) result.runIds.push(runId);
    const snapshot = recordValue(entry, "snapshot");
    if (numberValue(snapshot, "elementCount") === 0) result.zeroElementTurns += 1;
    const request = recordValue(entry, "llmRequest");
    const messages = Array.isArray(request?.messages) ? request.messages : [];
    if (
      messages.some(
        (message) =>
          isRecord(message) &&
          typeof message.content === "string" &&
          message.content.includes("Page Interpretation"),
      )
    ) {
      result.perceptions += 1;
    }
    const toolExecutions = Array.isArray(entry.toolExecutions)
      ? entry.toolExecutions
      : [];
    for (const execution of toolExecutions) {
      if (!isRecord(execution) || execution.success !== false) continue;
      result.toolFailures.push(
        `${stringValue(execution, "toolName") ?? "tool"}: ${
          stringValue(execution, "error") ??
          stringValue(execution, "result") ??
          "failed"
        }`,
      );
    }
    const events = Array.isArray(entry.events) ? entry.events : [];
    if (
      events.some(
        (event) =>
          isRecord(event) &&
          typeof event.type === "string" &&
          event.type.includes("replan"),
      )
    ) {
      result.replanEvents += 1;
    }
  }
  result.runIds = sortUnique(result.runIds);
  return result;
}

function runTraceFilesFor(runIds: string[]): string[] {
  const runDir = resolve(PROJECT_ROOT, "traces", "runs");
  return runIds
    .map((runId) => resolve(runDir, `${runId}.jsonl`))
    .filter((filePath) => existsSync(filePath));
}

export function analyzeSmokeTraces(traceFiles: string[]): TraceMetrics {
  const metrics: TraceMetrics = {
    turns: 0,
    perceptions: 0,
    runIds: [],
    runTraceFiles: [],
    missingTraceFiles: [],
    toolFailures: [],
    zeroElementTurns: 0,
    replanEvents: 0,
  };

  for (const rawPath of traceFiles) {
    const filePath = resolveInputPath(rawPath);
    if (!existsSync(filePath)) {
      metrics.missingTraceFiles.push(rawPath);
      continue;
    }
    const trace = parseTraceFile(filePath);
    metrics.turns += trace.turns;
    metrics.perceptions += trace.perceptions;
    metrics.runIds.push(...trace.runIds);
    metrics.toolFailures.push(...trace.toolFailures);
    metrics.zeroElementTurns += trace.zeroElementTurns;
    metrics.replanEvents += trace.replanEvents;
  }

  metrics.runIds = sortUnique(metrics.runIds);
  metrics.runTraceFiles = runTraceFilesFor(metrics.runIds);
  return metrics;
}

function isServiceNowResetApprovalGate(report: JsonRecord): boolean {
  const validation = recordValue(report, "validation");
  const details = recordValue(validation, "details");
  const message = stringValue(validation, "message")?.toLowerCase() ?? "";
  return (
    stringValue(report, "status") === "pending" &&
    booleanValue(details, "allowServiceNowReset") === false &&
    message.includes("--allow-servicenow-reset")
  );
}

function classifyFailure(report: JsonRecord, trace: TraceMetrics): string {
  const status = stringValue(report, "status");
  if (status === "passed") return "none";
  if (isServiceNowResetApprovalGate(report)) return "approval_gate";

  const validation = recordValue(report, "validation");
  const details = recordValue(validation, "details");
  const text = [
    stringValue(report, "failureStage"),
    stringValue(validation, "message"),
    stringValue(details, "agentTerminalReason"),
    ...((Array.isArray(report.errors) ? report.errors : []) as unknown[])
      .filter(isRecord)
      .map((error) => stringValue(error, "message")),
    ...trace.toolFailures,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/rate.?limit|provider|api error|fetch failed|etimedout|econnrefused/.test(text)) {
    return "provider";
  }
  if (/cdp|protocol error|target closed|websocket|browser .*crash|page crashed/.test(text)) {
    return "infrastructure";
  }
  if (/setup|reset|extension_launch|teardown/.test(text) || trace.missingTraceFiles.length > 0) {
    return "harness";
  }
  if (/bridge|content script|chrome\.runtime|tab not found|no active tab/.test(text)) {
    return "runtime";
  }
  return "product";
}

function selectFixLayer(report: JsonRecord, trace: TraceMetrics): WorkArenaSmokeFixLayer {
  const status = stringValue(report, "status");
  const failureStage = stringValue(report, "failureStage");
  if (status === "passed") return "no immediate fix";
  if (isServiceNowResetApprovalGate(report)) return "approval required";
  if (trace.missingTraceFiles.length > 0) return "trace/report instrumentation";
  if (
    failureStage === "setup" ||
    failureStage === "reset" ||
    failureStage === "extension_launch" ||
    failureStage === "teardown" ||
    failureStage === "validation"
  ) {
    return "harness/session/validation";
  }
  if (trace.zeroElementTurns > 0) return "perception/page-state";
  if (trace.toolFailures.length > 0) return "tool/runtime";
  if (failureStage === "agent_run" || trace.replanEvents > 0 || trace.turns > 18) {
    return "planner/skill policy";
  }
  return "no immediate fix";
}

function recommendedAction(layer: WorkArenaSmokeFixLayer): string {
  if (layer === "approval required") {
    return "Get explicit approval acknowledging ServiceNow reset/mutation before running --allow-servicenow-reset";
  }
  if (layer === "harness/session/validation") return "Harness/session fix";
  if (layer === "perception/page-state") return "Runtime fix";
  if (layer === "tool/runtime") return "Runtime fix";
  if (layer === "planner/skill policy") return "Skill/policy fix";
  if (layer === "trace/report instrumentation") {
    return "Trace/report instrumentation fix";
  }
  return "No immediate action";
}

function primaryEvidence(report: JsonRecord, trace: TraceMetrics): string {
  const validation = recordValue(report, "validation");
  const details = recordValue(validation, "details");
  const validationMessage = stringValue(validation, "message");
  const terminal =
    stringValue(details, "agentTerminalReason") ??
    stringValue(recordValue(details, "agentTerminal"), "reason");
  const pieces = [
    `status=${stringValue(report, "status") ?? "unknown"}`,
    `failureStage=${stringValue(report, "failureStage") ?? "none"}`,
    `validation=${String(booleanValue(validation, "passed"))}`,
    isServiceNowResetApprovalGate(report) && validationMessage
      ? `approvalGate=${validationMessage}`
      : null,
    terminal ? `terminal=${terminal}` : null,
    trace.missingTraceFiles.length > 0
      ? `missingTraceFiles=${trace.missingTraceFiles.length}`
      : null,
    trace.toolFailures[0] ? `toolFailure=${trace.toolFailures[0]}` : null,
  ].filter(Boolean);
  return pieces.join("; ");
}

export function buildSmokeSummary(
  filePath: string,
): WorkArenaSmokeSummary {
  const sourceFile = resolveInputPath(filePath);
  const raw = JSON.parse(readFileSync(sourceFile, "utf-8")) as unknown;
  const errors = validateWorkArenaReport(raw);
  if (errors.length > 0) {
    throw new Error(
      `invalid WorkArena report: ${errors
        .slice(0, 3)
        .map((error) => `${error.path} ${error.message}`)
        .join("; ")}`,
    );
  }
  if (!isRecord(raw) || raw.mode !== "agent-execution") {
    throw new Error("expected a WorkArena agent-execution report");
  }

  const task = recordValue(raw, "task");
  const prompt = recordValue(raw, "prompt");
  const agent = recordValue(raw, "agent");
  const validation = recordValue(raw, "validation");
  const details = recordValue(validation, "details");
  const tokens = recordValue(agent, "tokens");
  const traceFiles = stringArray(agent, "traceFiles");
  const trace = analyzeSmokeTraces(traceFiles);
  const resetApprovalGate = isServiceNowResetApprovalGate(raw);
  const nextFixLayer = selectFixLayer(raw, trace);

  return {
    sourceFile,
    taskId: stringValue(task, "taskId") ?? "unknown",
    seed: numberValue(task, "seed"),
    promptSource: stringValue(prompt, "source") ?? "unknown",
    validationPassed: booleanValue(validation, "passed"),
    score: numberValue(validation, "score"),
    terminalReason:
      stringValue(details, "agentTerminalReason") ??
      stringValue(recordValue(details, "agentTerminal"), "reason"),
    failureClass: classifyFailure(raw, trace),
    traceIds: stringArray(agent, "traceIds"),
    traceFiles,
    runIds: trace.runIds,
    runTraceFiles: trace.runTraceFiles,
    turns: numberValue(agent, "turns") ?? (trace.turns > 0 ? trace.turns : null),
    perceptions:
      numberValue(agent, "perceptions") ??
      (trace.perceptions > 0 ? trace.perceptions : null),
    tokens: numberValue(tokens, "total"),
    costUsd: numberValue(agent, "costUsd"),
    diagnostics: [
      ...(resetApprovalGate ? ["approval required: --allow-servicenow-reset"] : []),
      ...trace.missingTraceFiles.map((file) => `missing trace: ${file}`),
      ...trace.toolFailures.slice(0, 5).map((failure) => `tool failure: ${failure}`),
    ],
    primaryEvidence: primaryEvidence(raw, trace),
    nextFixLayer,
    recommendedAction: recommendedAction(nextFixLayer),
    featureListItem: "HR-005",
  };
}

function markdownList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

export function renderSmokeFollowUp(summary: WorkArenaSmokeSummary, generatedAt = new Date()): string {
  return [
    "# WorkArena Smoke Follow-Up",
    "",
    `Date: ${generatedAt.toISOString().split("T")[0]}`,
    `Task: ${summary.taskId}`,
    `Seed: ${summary.seed ?? "-"}`,
    `Prompt source: ${summary.promptSource}`,
    `Validation passed: ${String(summary.validationPassed)}`,
    `Score: ${summary.score ?? "-"}`,
    `Failure class: ${summary.failureClass}`,
    `Terminal reason: ${summary.terminalReason ?? "-"}`,
    `Turns: ${summary.turns ?? "-"}`,
    `Perceptions: ${summary.perceptions ?? "-"}`,
    `Tokens/cost: ${summary.tokens ?? "-"} / ${summary.costUsd ?? "-"}`,
    `Trace IDs: ${markdownList(summary.traceIds)}`,
    `Trace files: ${markdownList(summary.traceFiles)}`,
    `Run IDs: ${markdownList(summary.runIds)}`,
    `Run trace files: ${markdownList(summary.runTraceFiles)}`,
    `Diagnostics: ${markdownList(summary.diagnostics)}`,
    `Primary evidence: ${summary.primaryEvidence || "-"}`,
    `Next fix layer: ${summary.nextFixLayer}`,
    "Recommended action:",
    `  - ${summary.recommendedAction}`,
    `Feature-list item: ${summary.featureListItem}`,
    `Source report: ${summary.sourceFile}`,
    "",
  ].join("\n");
}

function writeFollowUp(summary: WorkArenaSmokeSummary, content: string, output: string | null): string {
  const reportPath = output
    ? resolveInputPath(output)
    : resolve(
        REPORTS_DIR,
        `workarena-smoke-follow-up-${today()}-${safeFilePart(summary.taskId)}.md`,
      );
  const reportDir = dirname(reportPath);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, content, "utf-8");
  return reportPath;
}

function main(): void {
  const args = parseArgs();
  const file = args.file ? resolveInputPath(args.file) : discoverLatestExecutionReport();
  if (!file) {
    throw new Error("No WorkArena agent-execution report found. Pass --file <report.json>.");
  }
  const generatedAt = new Date();
  const summary = buildSmokeSummary(file);
  const markdown = renderSmokeFollowUp(summary, generatedAt);
  const reportPath = args.noReport ? null : writeFollowUp(summary, markdown, args.output);

  if (args.json) {
    console.log(JSON.stringify({ reportPath, summary }, null, 2));
  } else {
    process.stdout.write(markdown);
    if (reportPath) console.log(`[workarena:smoke-summary] Report: ${reportPath}`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
