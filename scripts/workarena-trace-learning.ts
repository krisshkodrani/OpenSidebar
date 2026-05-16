#!/usr/bin/env tsx

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { PROJECT_ROOT, REPORTS_DIR, today } from "./workarena-adapter-lib.js";

type JsonRecord = Record<string, unknown>;

export type WorkArenaTraceLearningArgs = {
  files: string[];
  includePending: boolean;
  json: boolean;
  noReport: boolean;
  output: string | null;
};

export type WorkArenaTraceLearningResult = {
  reportPath: string | null;
  skippedPending: number;
  records: WorkArenaTraceLearningRecord[];
};

type ToolFailure = {
  tool: string;
  error: string;
  traceFile: string;
  turn: number;
};

type ToolCallSummary = {
  tool: string;
  count: number;
};

type ResetAttemptSummary = {
  attempt: number | null;
  status: string | null;
  error: string | null;
  retryable: boolean | null;
  diagnostics: JsonRecord | null;
};

type TraceAnalysis = {
  traceFiles: string[];
  missingTraceFiles: string[];
  turns: number;
  perceptions: number;
  toolCalls: ToolCallSummary[];
  toolFailures: ToolFailure[];
  eventCounts: Array<{ event: string; count: number }>;
  skillIds: string[];
  selectedSkillIds: string[];
  minElementCount: number | null;
  maxElementCount: number | null;
  zeroElementTurns: number;
  urls: string[];
};

export type WorkArenaTraceLearningRecord = {
  sourceFile: string;
  taskId: string;
  category: string | null;
  status: string;
  passed: boolean | null;
  failureStage: string | null;
  prompt: string;
  turns: number | null;
  traces: number;
  resetAttempts: ResetAttemptSummary[];
  trace: TraceAnalysis;
  fixLayer: string;
  signals: string[];
  recommendation: string;
  skillOpportunity: string | null;
};

function parseArgs(): WorkArenaTraceLearningArgs {
  const args = process.argv.slice(2);
  const files: string[] = [];
  let output: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--file") {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        files.push(next);
        index += 1;
      }
    } else if (arg === "--output") {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        output = next;
        index += 1;
      }
    } else if (!arg.startsWith("--")) {
      files.push(arg);
    }
  }

  return {
    files,
    output,
    includePending: args.includes("--include-pending"),
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function recordValue(record: JsonRecord | null | undefined, key: string): JsonRecord {
  if (!record) return {};
  return isRecord(record[key]) ? (record[key] as JsonRecord) : {};
}

function arrayValue<T = unknown>(record: JsonRecord | null | undefined, key: string): T[] {
  if (!record) return [];
  return Array.isArray(record[key]) ? (record[key] as T[]) : [];
}

function discoverReports(): string[] {
  if (!existsSync(REPORTS_DIR)) return [];
  return readdirSync(REPORTS_DIR)
    .filter((name) => /^workarena-.*\.json$/.test(name))
    .map((name) => resolve(REPORTS_DIR, name))
    .sort();
}

function resolveInputPath(file: string): string {
  return isAbsolute(file) ? file : resolve(process.cwd(), file);
}

function compact(value: string | null | undefined, maxLength = 140): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function markdown(value: string | null | undefined): string {
  const text = compact(value, 180);
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function parseToolArguments(raw: unknown): JsonRecord {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toolNameFromCall(call: unknown): string | null {
  if (!isRecord(call)) return null;
  const direct = stringValue(call, "name");
  if (direct) return direct;
  const fn = recordValue(call, "function");
  return stringValue(fn, "name");
}

function toolArgsFromCall(call: unknown): JsonRecord {
  if (!isRecord(call)) return {};
  const direct = recordValue(call, "args");
  if (Object.keys(direct).length > 0) return direct;
  const fn = recordValue(call, "function");
  return parseToolArguments(fn.arguments);
}

function countMapToSortedArray(map: Map<string, number>, keyName: "tool" | "event"):
  Array<ToolCallSummary | { event: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) =>
      keyName === "tool" ? { tool: key, count } : { event: key, count },
    );
}

function extractRunId(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const lines = readFileSync(filePath, "utf-8").trim().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed) && typeof parsed.runId === "string") return parsed.runId;
    }
  } catch {
    return null;
  }
  return null;
}

function readRunTraceSkills(runIds: Iterable<string>): string[] {
  const skillIds = new Set<string>();
  const runTraceDir = resolve(PROJECT_ROOT, "traces", "runs");

  for (const runId of runIds) {
    const filePath = join(runTraceDir, `${runId}.jsonl`);
    if (!existsSync(filePath)) continue;
    try {
      const lines = readFileSync(filePath, "utf-8").trim().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line) as unknown;
        if (!isRecord(parsed)) continue;
        const data = recordValue(parsed, "data");
        const selectedSkillId = stringValue(data, "selectedSkillId");
        if (selectedSkillId) skillIds.add(selectedSkillId);

        for (const item of arrayValue<JsonRecord>(data, "skills")) {
          const skillId = stringValue(item, "skillId");
          if (skillId) skillIds.add(skillId);
        }
      }
    } catch {
      continue;
    }
  }

  return [...skillIds].sort();
}

function analyzeTraces(traceFiles: string[]): TraceAnalysis {
  const missingTraceFiles: string[] = [];
  const toolCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  const toolFailures: ToolFailure[] = [];
  const selectedSkillIds = new Set<string>();
  const urls = new Set<string>();
  const runIds = new Set<string>();
  let turns = 0;
  let perceptions = 0;
  let minElementCount: number | null = null;
  let maxElementCount: number | null = null;
  let zeroElementTurns = 0;

  for (const traceFile of traceFiles) {
    const filePath = resolveInputPath(traceFile);
    if (!existsSync(filePath)) {
      missingTraceFiles.push(traceFile);
      continue;
    }

    const runId = extractRunId(filePath);
    if (runId) runIds.add(runId);

    const lines = readFileSync(filePath, "utf-8").trim().split(/\r?\n/).filter(Boolean);
    turns += lines.length;

    for (const line of lines) {
      let entry: JsonRecord;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isRecord(parsed)) continue;
        entry = parsed;
      } catch {
        continue;
      }

      const turn = numberValue(entry, "turnNumber") ?? 0;
      const snapshot = recordValue(entry, "snapshot");
      const elementCount = numberValue(snapshot, "elementCount");
      if (elementCount !== null) {
        minElementCount = minElementCount === null ? elementCount : Math.min(minElementCount, elementCount);
        maxElementCount = maxElementCount === null ? elementCount : Math.max(maxElementCount, elementCount);
        if (elementCount === 0) zeroElementTurns += 1;
      }
      const url = stringValue(snapshot, "url");
      if (url) urls.add(url);

      const messages = arrayValue<JsonRecord>(recordValue(entry, "llmRequest"), "messages");
      if (
        messages.some(
          (message) =>
            typeof message.content === "string" &&
            message.content.includes("Page Interpretation"),
        )
      ) {
        perceptions += 1;
      }

      for (const call of arrayValue(recordValue(entry, "llmResponse"), "toolCalls")) {
        const name = toolNameFromCall(call);
        if (!name) continue;
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
        const args = toolArgsFromCall(call);
        const skillId = stringValue(args, "skillId");
        if (skillId) selectedSkillIds.add(skillId);
      }

      for (const execution of arrayValue<JsonRecord>(entry, "toolExecutions")) {
        const name = stringValue(execution, "toolName") ?? "?";
        const ok = booleanValue(execution, "success");
        const error =
          stringValue(execution, "error") ??
          (ok === false ? compact(String(execution.result ?? "tool returned unsuccessful result")) : null);
        if (error) {
          toolFailures.push({
            tool: name,
            error,
            traceFile: basename(filePath),
            turn,
          });
        }
      }

      for (const event of arrayValue<JsonRecord>(entry, "events")) {
        const type = stringValue(event, "type");
        if (!type) continue;
        eventCounts.set(type, (eventCounts.get(type) ?? 0) + 1);
        const data = recordValue(event, "data");
        const skillId = stringValue(data, "skillId");
        if (skillId) selectedSkillIds.add(skillId);
      }
    }
  }

  const runTraceSkillIds = readRunTraceSkills(runIds);
  for (const skillId of runTraceSkillIds) selectedSkillIds.add(skillId);

  return {
    traceFiles,
    missingTraceFiles,
    turns,
    perceptions,
    toolCalls: countMapToSortedArray(toolCounts, "tool") as ToolCallSummary[],
    toolFailures,
    eventCounts: countMapToSortedArray(eventCounts, "event") as Array<{ event: string; count: number }>,
    skillIds: [...selectedSkillIds].sort(),
    selectedSkillIds: [...selectedSkillIds].sort(),
    minElementCount,
    maxElementCount,
    zeroElementTurns,
    urls: [...urls].slice(0, 8),
  };
}

function extractResetAttempts(report: JsonRecord): ResetAttemptSummary[] {
  const validation = recordValue(report, "validation");
  const details = recordValue(validation, "details");
  const source = recordValue(details, "source");
  const attempts =
    arrayValue<JsonRecord>(details, "resetAttempts").length > 0
      ? arrayValue<JsonRecord>(details, "resetAttempts")
      : arrayValue<JsonRecord>(source, "resetAttempts");

  return attempts.map((attempt) => ({
    attempt: numberValue(attempt, "attempt"),
    status: stringValue(attempt, "status"),
    error: stringValue(attempt, "error"),
    retryable: booleanValue(attempt, "retryable"),
    diagnostics: isRecord(attempt.diagnostics) ? (attempt.diagnostics as JsonRecord) : null,
  }));
}

function classifyFixLayer(report: JsonRecord, trace: TraceAnalysis, signals: string[]): string {
  const failureStage = stringValue(report, "failureStage");
  const validation = recordValue(report, "validation");
  const details = recordValue(validation, "details");
  const terminalReason =
    stringValue(details, "agentTerminalReason") ??
    stringValue(recordValue(details, "agentTerminal"), "reason");
  const toolFailureText = trace.toolFailures.map((failure) => failure.error).join(" ").toLowerCase();
  const messageText = [
    stringValue(validation, "message"),
    ...arrayValue<JsonRecord>(report, "errors").map((error) => stringValue(error, "message")),
    terminalReason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (failureStage === "setup" || failureStage === "reset" || failureStage === "teardown") {
    return "WorkArena harness/session";
  }
  if (stringValue(report, "status") === "pending" && trace.traceFiles.length === 0) {
    return "Pending/no agent run";
  }
  if (failureStage === "extension_launch") {
    return "WorkArena harness/session";
  }
  if (trace.missingTraceFiles.length > 0) {
    return "Trace/report instrumentation";
  }
  if (
    trace.zeroElementTurns > 0 ||
    toolFailureText.includes("not found") ||
    toolFailureText.includes("no element") ||
    toolFailureText.includes("selector") ||
    signals.some((signal) => signal.includes("low DOM visibility"))
  ) {
    return "DOM/perception runtime";
  }
  if (
    failureStage === "validation" ||
    messageText.includes("not at expected url") ||
    messageText.includes("validation")
  ) {
    return "Validation/session sync";
  }
  if (
    failureStage === "agent_run" ||
    messageText.includes("task_partial") ||
    messageText.includes("missing entities") ||
    messageText.includes("timeout") ||
    trace.eventCounts.some((event) => event.event.includes("replan"))
  ) {
    return "Planner/skill policy";
  }
  if (trace.toolFailures.length > 0) {
    return "Tool execution runtime";
  }
  if (stringValue(report, "status") === "passed" && (trace.turns > 18 || trace.traceFiles.length > 3)) {
    return "Skill/policy optimization";
  }
  return "No immediate fix";
}

function inferSkillOpportunity(report: JsonRecord, trace: TraceAnalysis): string | null {
  const task = recordValue(report, "task");
  const category = stringValue(task, "category");
  const prompt = stringValue(recordValue(report, "prompt"), "value") ?? "";
  const skills = new Set(trace.skillIds);

  if (
    category === "menu" ||
    /navigate to|module|application|all menu|configuration/i.test(prompt)
  ) {
    if (!skills.has("service-now-application-navigator")) {
      return "Consider a ServiceNow application-navigator skill for All menu filtering, parent expansion, and module-link verification.";
    }
  }
  if (category === "form" && !skills.has("structured-form-fill")) {
    return "Evaluate whether structured-form-fill should be selected for this form workflow.";
  }
  if (category === "list-filter" || category === "list-sort") {
    return "Consider a ServiceNow list/table skill covering filter chips, column sort, and result verification.";
  }
  if (category === "information_retrieval" && trace.turns > 12) {
    return "Review whether list-detail-review-loop or paginated-record-lookup is selected early enough.";
  }
  if (category === "data_driven_decision_making_and_reasoning") {
    return "Look for repeated table-scan or aggregate reasoning patterns before adding a category-wide skill.";
  }
  if (skills.has("paginated-record-lookup") && /menu|module|application/i.test(prompt)) {
    return "paginated-record-lookup is being used for a navigator task; prefer a dedicated menu/navigation skill.";
  }
  return null;
}

function buildSignals(report: JsonRecord, trace: TraceAnalysis, resetAttempts: ResetAttemptSummary[]): string[] {
  const signals: string[] = [];
  const failureStage = stringValue(report, "failureStage");
  const validation = recordValue(report, "validation");
  const details = recordValue(validation, "details");
  const status = stringValue(report, "status");
  const passed = booleanValue(validation, "passed");

  if (status) signals.push(`status=${status}`);
  if (failureStage) signals.push(`failureStage=${failureStage}`);
  if (passed !== null) signals.push(`validation=${passed}`);
  if (resetAttempts.length > 0) {
    signals.push(`resetAttempts=${resetAttempts.length}`);
    const resetErrors = resetAttempts.map((attempt) => attempt.error).filter(Boolean);
    if (resetErrors.length > 0) signals.push(`resetErrors=${compact(resetErrors.join("; "), 100)}`);
  }
  if (trace.missingTraceFiles.length > 0) {
    signals.push(`missingTraceFiles=${trace.missingTraceFiles.length}`);
  }
  if (trace.toolFailures.length > 0) {
    const topFailure = trace.toolFailures[0];
    signals.push(`toolFailure=${topFailure.tool}: ${compact(topFailure.error, 90)}`);
  }
  if (trace.zeroElementTurns > 0) {
    signals.push(`zeroElementTurns=${trace.zeroElementTurns}`);
  }
  if (trace.minElementCount !== null && trace.minElementCount < 5) {
    signals.push(`low DOM visibility: minElementCount=${trace.minElementCount}`);
  }
  if (trace.turns > 18) {
    signals.push(`highTurns=${trace.turns}`);
  }
  if (trace.traceFiles.length > 3) {
    signals.push(`manyTraces=${trace.traceFiles.length}`);
  }

  const terminalReason =
    stringValue(details, "agentTerminalReason") ??
    stringValue(recordValue(details, "agentTerminal"), "reason");
  if (terminalReason) signals.push(`terminal=${terminalReason}`);

  const message = stringValue(validation, "message");
  if (message) signals.push(`validationMessage=${compact(message, 90)}`);

  return signals;
}

function buildRecommendation(
  record: Omit<WorkArenaTraceLearningRecord, "recommendation">,
): string {
  const opportunity = record.skillOpportunity;
  if (record.fixLayer === "WorkArena harness/session") {
    return "Inspect reset/session diagnostics first; rerun only after reset errors are classified as transient or fixed.";
  }
  if (record.fixLayer === "Pending/no agent run") {
    return "No trace learning available until this report is backed by a real agent run.";
  }
  if (record.fixLayer === "Trace/report instrumentation") {
    return "Repair trace/report linking before drawing product conclusions from this run.";
  }
  if (record.fixLayer === "DOM/perception runtime") {
    return "Inspect the failing turn snapshot and fix content scanning, shadow DOM traversal, iframe traversal, or element ranking in runtime code.";
  }
  if (record.fixLayer === "Validation/session sync") {
    return "Compare final OpenSidebar URL/state with BrowserGym validation state; fix handoff validation before changing agent behavior.";
  }
  if (record.fixLayer === "Planner/skill policy") {
    return opportunity ?? "Inspect selected skill and plan decomposition; update skill matching or workflow policy only if the pattern repeats.";
  }
  if (record.fixLayer === "Tool execution runtime") {
    return "Reproduce the failed tool call with its tag/text target and fix the underlying tool behavior or recovery path.";
  }
  if (record.fixLayer === "Skill/policy optimization") {
    return opportunity ?? "The task passed but was inefficient; inspect replans and selected skills before optimizing prompts or policies.";
  }
  return opportunity ?? "No immediate action; use this as a passing baseline.";
}

function analyzeReport(filePath: string): WorkArenaTraceLearningRecord | null {
  const raw = readFileSync(filePath, "utf-8");
  const report = JSON.parse(raw) as unknown;
  if (!isRecord(report)) return null;
  if (report.benchmark !== "workarena" || report.mode !== "agent-execution") return null;

  const task = recordValue(report, "task");
  const prompt = recordValue(report, "prompt");
  const agent = recordValue(report, "agent");
  const validation = recordValue(report, "validation");
  const traceFiles = arrayValue<string>(agent, "traceFiles").filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const trace = analyzeTraces(traceFiles);
  const resetAttempts = extractResetAttempts(report);
  const partialRecord = {
    sourceFile: filePath,
    taskId: stringValue(task, "taskId") ?? basename(filePath),
    category: stringValue(task, "category"),
    status: stringValue(report, "status") ?? "unknown",
    passed: booleanValue(validation, "passed"),
    failureStage: stringValue(report, "failureStage"),
    prompt: stringValue(prompt, "value") ?? "",
    turns: numberValue(agent, "turns"),
    traces: traceFiles.length,
    resetAttempts,
    trace,
    fixLayer: "No immediate fix",
    signals: [] as string[],
    skillOpportunity: null as string | null,
  };
  const signals = buildSignals(report, trace, resetAttempts);
  const fixLayer = classifyFixLayer(report, trace, signals);
  const skillOpportunity = inferSkillOpportunity(report, trace);
  const recordWithoutRecommendation = {
    ...partialRecord,
    fixLayer,
    signals,
    skillOpportunity,
  };

  return {
    ...recordWithoutRecommendation,
    recommendation: buildRecommendation(recordWithoutRecommendation),
  };
}

function groupCounts(
  records: WorkArenaTraceLearningRecord[],
  key: (record: WorkArenaTraceLearningRecord) => string,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = key(record);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([groupKey, count]) => ({ key: groupKey, count }));
}

function buildMarkdownReport(
  records: WorkArenaTraceLearningRecord[],
  generatedAt = new Date(),
): string {
  const passed = records.filter((record) => record.status === "passed" && record.passed === true).length;
  const failed = records.length - passed;
  const lines: string[] = [];

  lines.push("# WorkArena Trace Learning Report");
  lines.push("");
  lines.push(`Date: ${generatedAt.toISOString().split("T")[0]}`);
  lines.push(`Scope: ${records.length} WorkArena agent-execution report(s).`);
  lines.push(`Overall result: ${passed}/${records.length} passed, ${failed} need attention or review.`);
  lines.push("");

  lines.push("## Fix-Layer Summary");
  lines.push("");
  lines.push("| Fix layer | Reports |");
  lines.push("| --- | ---: |");
  for (const item of groupCounts(records, (record) => record.fixLayer)) {
    lines.push(`| ${item.key} | ${item.count} |`);
  }
  lines.push("");

  lines.push("## Task Findings");
  lines.push("");
  lines.push(
    "| Task | Status | Category | Fix layer | Turns | Traces | Reset attempts | Skills | Signals | Recommendation |",
  );
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |");
  for (const record of records) {
    lines.push(
      `| \`${markdown(record.taskId)}\` | ${record.status}${record.passed === false ? " / validation=false" : ""} | ${markdown(record.category ?? "unknown")} | ${record.fixLayer} | ${record.turns ?? record.trace.turns} | ${record.traces} | ${record.resetAttempts.length} | ${markdown(record.trace.skillIds.join(", ") || "(none)")} | ${markdown(record.signals.slice(0, 4).join("; "))} | ${markdown(record.recommendation)} |`,
    );
  }
  lines.push("");

  const skillOpportunities = records.filter((record) => record.skillOpportunity);
  lines.push("## Skill Opportunities");
  lines.push("");
  if (skillOpportunities.length === 0) {
    lines.push("No new skill opportunity was inferred from the current report set.");
  } else {
    for (const record of skillOpportunities) {
      lines.push(
        `- \`${record.taskId}\`: ${record.skillOpportunity} Current skills: ${record.trace.skillIds.join(", ") || "(none)"}.`,
      );
    }
  }
  lines.push("");

  lines.push("## Failure/Signal Clusters");
  lines.push("");
  for (const item of groupCounts(records, (record) => record.fixLayer)) {
    const examples = records
      .filter((record) => record.fixLayer === item.key)
      .slice(0, 5)
      .map((record) => `\`${record.taskId}\``)
      .join(", ");
    lines.push(`- ${item.key}: ${item.count} report(s). Examples: ${examples}.`);
  }
  lines.push("");

  lines.push("## Artifact Index");
  lines.push("");
  for (const record of records) {
    lines.push(`### ${record.taskId}`);
    lines.push("");
    lines.push(`- Source report: \`${record.sourceFile}\``);
    lines.push(`- Prompt: ${markdown(record.prompt) || "(none)"}`);
    lines.push(`- Trace files: ${record.trace.traceFiles.length}`);
    for (const traceFile of record.trace.traceFiles.slice(0, 8)) {
      lines.push(`  - \`${traceFile}\``);
    }
    if (record.trace.missingTraceFiles.length > 0) {
      lines.push(`- Missing trace files: ${record.trace.missingTraceFiles.length}`);
    }
    if (record.trace.toolFailures.length > 0) {
      lines.push("- Tool failures:");
      for (const failure of record.trace.toolFailures.slice(0, 5)) {
        lines.push(`  - T${failure.turn} \`${failure.tool}\`: ${markdown(failure.error)}`);
      }
    }
    lines.push("");
  }

  lines.push("## Method");
  lines.push("");
  lines.push(
    "The analyzer reads WorkArena `agent-execution` JSON reports, follows their trace file references, counts turns/perception prompts/tool calls/tool failures, extracts skill telemetry, and classifies each run into the likely fix layer. Recommendations are heuristics intended to route investigation, not proof of root cause.",
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

function writeMarkdownReport(content: string, output: string | null): string {
  const reportPath = output
    ? resolveInputPath(output)
    : resolve(REPORTS_DIR, `workarena-trace-learning-${today()}.md`);
  const dir = dirname(reportPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(reportPath, content, "utf-8");
  return reportPath;
}

function printHuman(
  records: WorkArenaTraceLearningRecord[],
  reportPath: string | null,
  skippedPending: number,
): void {
  const passed = records.filter((record) => record.status === "passed" && record.passed === true).length;
  console.log("\n[workarena:trace-learning] WorkArena trace learning report");
  console.log(`[workarena:trace-learning] Reports analyzed: ${records.length}`);
  if (skippedPending > 0) {
    console.log(
      `[workarena:trace-learning] Pending/no-trace reports skipped: ${skippedPending} (use --include-pending to include them)`,
    );
  }
  console.log(`[workarena:trace-learning] Passed: ${passed}`);
  console.log(`[workarena:trace-learning] Needs review: ${records.length - passed}`);
  for (const item of groupCounts(records, (record) => record.fixLayer)) {
    console.log(`[workarena:trace-learning] ${item.key}: ${item.count}`);
  }
  if (reportPath) {
    console.log(`[workarena:trace-learning] Report: ${reportPath}`);
  }
}

export function runTraceLearning(
  args: WorkArenaTraceLearningArgs,
): WorkArenaTraceLearningResult {
  const files =
    args.files.length > 0 ? args.files.map(resolveInputPath) : discoverReports();
  const allRecords = files
    .map((file) => {
      try {
        return analyzeReport(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[workarena:trace-learning] Skipping ${file}: ${message}`);
        return null;
      }
    })
    .filter((record): record is WorkArenaTraceLearningRecord => record !== null);
  const pendingNoTraceRecords = allRecords.filter(
    (record) => record.status === "pending" && record.trace.traceFiles.length === 0,
  );
  const skippedPending = args.includePending ? 0 : pendingNoTraceRecords.length;
  const records = args.includePending
    ? allRecords
    : allRecords.filter(
        (record) => !(record.status === "pending" && record.trace.traceFiles.length === 0),
      );

  const markdownReport = buildMarkdownReport(records);
  const reportPath = args.noReport ? null : writeMarkdownReport(markdownReport, args.output);
  return { reportPath, skippedPending, records };
}

function main(): void {
  const args = parseArgs();
  const result = runTraceLearning(args);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result.records, result.reportPath, result.skippedPending);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
