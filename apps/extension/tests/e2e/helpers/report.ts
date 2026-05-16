/**
 * E2E suite report.
 *
 * Collects per-test results, prints a concise console summary, and writes a
 * dated markdown report to a local untracked artifacts folder.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type {
  TraceEntry,
  TraceLLMMessage,
  TraceSession,
} from "../../../src/types/traces";
import {
  computeSessionDiagnostics,
  type SessionDiagnostics,
} from "../../../src/trace-viewer/diagnostics";
import {
  collectFormTraceMetrics,
  extractRunIdFromTraceFile,
  readSkillSummaryForRun,
  readTrace,
  type FormTraceMetrics,
  type TraceTurn,
} from "./diagnostics";
import type {
  HarnessDiagnostic,
  TraceArtifactBundle,
} from "./trace-artifacts";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const TRACE_INDEX = resolve(PROJECT_ROOT, "traces", "index.jsonl");

interface TestRecord {
  name: string;
  passed: boolean | null;
  durationMs: number;
  traceFiles: string[];
  runTraceFiles: string[];
  runIds: string[];
  harnessDiagnostics: HarnessDiagnostic[];
}

interface RunMetadata {
  provider: string;
  lane: string;
  configuredExecutorModel?: string | null;
  diagnosticMode?: boolean;
}

interface TraceCostData {
  turns: number;
  cost: number;
}

type FailureClass =
  | "provider"
  | "infrastructure"
  | "harness"
  | "runtime"
  | "product"
  | "unknown"
  | null;

type AnalysisTraceTurn = TraceTurn & { traceOrdinal?: number };

interface E2EFailureEvidence {
  failureClass: NonNullable<FailureClass>;
  firstBadTurnRef: string;
  signals: string[];
  diagnostics: HarnessDiagnostic[];
}

interface E2EReportIndexEntry {
  path: string;
  generatedAt: string;
  caseCount: number;
  traceFiles: string[];
  runTraceFiles: string[];
}

interface TraceAnalysis extends TraceCostData {
  traceCount: number;
  runTraceCount: number;
  pageInterpretationTurns: number;
  promptUsed: string;
  toolCounts: Record<string, number>;
  repeatedTools: string[];
  model: string | undefined;
  turnDetails: AnalysisTraceTurn[];
  runIds: string[];
  sessionIds: string[];
  skillsUsed: string[];
  nodeSkills: Array<{ nodeId: string; skillId: string; reason?: string }>;
  diagnostics: SessionDiagnostics;
  harnessDiagnostics: HarnessDiagnostic[];
  failureClass: FailureClass;
  failureEvidence: E2EFailureEvidence | null;
  formMetrics: FormTraceMetrics | null;
}

function createEmptyDiagnostics(): SessionDiagnostics {
  return {
    productiveTurns: 0,
    wastedTurns: 0,
    loopTurns: 0,
    escalations: 0,
    failovers: 0,
    perceptionCalls: 0,
    perceptionCacheHits: 0,
    structuredPerceptionTurns: 0,
    vlScreenshotTurns: 0,
    elementOnlyTurns: 0,
    degradedPerceptionTurns: 0,
    contextHotTurns: 0,
    toolFailureTurns: 0,
    perceptionSources: {},
    perceptionFreshness: {},
    perceptionFallbacks: {},
    perceptionScreenshots: {},
  };
}

function mergeCounters<T extends string>(
  target: Partial<Record<T, number>>,
  source: Partial<Record<T, number>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue;
    const typedKey = key as T;
    target[typedKey] = (target[typedKey] ?? 0) + value;
  }
}

function mergeDiagnostics(
  target: SessionDiagnostics,
  source: SessionDiagnostics,
): SessionDiagnostics {
  target.productiveTurns += source.productiveTurns;
  target.wastedTurns += source.wastedTurns;
  target.loopTurns += source.loopTurns;
  target.escalations += source.escalations;
  target.failovers += source.failovers;
  target.perceptionCalls += source.perceptionCalls;
  target.perceptionCacheHits += source.perceptionCacheHits;
  target.structuredPerceptionTurns += source.structuredPerceptionTurns;
  target.vlScreenshotTurns += source.vlScreenshotTurns;
  target.elementOnlyTurns += source.elementOnlyTurns;
  target.degradedPerceptionTurns += source.degradedPerceptionTurns;
  target.contextHotTurns += source.contextHotTurns;
  target.toolFailureTurns += source.toolFailureTurns;
  mergeCounters(target.perceptionSources, source.perceptionSources);
  mergeCounters(target.perceptionFreshness, source.perceptionFreshness);
  mergeCounters(target.perceptionFallbacks, source.perceptionFallbacks);
  mergeCounters(target.perceptionScreenshots, source.perceptionScreenshots);
  return target;
}

function readTraceEntries(filePath: string): TraceEntry[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as TraceEntry;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as TraceEntry[];
}

function readTraceSessions(): Map<string, TraceSession> {
  const sessions = new Map<string, TraceSession>();
  if (!existsSync(TRACE_INDEX)) return sessions;

  const lines = readFileSync(TRACE_INDEX, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const line of lines) {
    try {
      const session = JSON.parse(line) as TraceSession;
      if (
        typeof session.sessionId === "string" &&
        session.sessionId.length > 0
      ) {
        sessions.set(session.sessionId, session);
      }
    } catch {
      // Ignore malformed session records and keep scanning the index.
    }
  }
  return sessions;
}

function getSessionIdFromTraceFile(
  filePath: string,
  entries: TraceEntry[],
): string {
  const entrySessionId = entries[0]?.sessionId;
  if (typeof entrySessionId === "string" && entrySessionId.length > 0) {
    return entrySessionId;
  }
  return basename(filePath, ".jsonl");
}

function compactPrompt(prompt: string, maxLength: number = 140): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (!compact) return "-";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function messageContainsPageInterpretation(message: TraceLLMMessage): boolean {
  return (
    typeof message.content === "string" &&
    message.content.includes("Page Interpretation")
  );
}

function countPageInterpretationTurns(entries: TraceEntry[]): number {
  let turns = 0;
  for (const entry of entries) {
    const messages = entry.llmRequest?.messages ?? [];
    if (messages.some(messageContainsPageInterpretation)) {
      turns++;
    }
  }
  return turns;
}

/**
 * Classify a test failure by inspecting trace evidence.
 *
 * - provider: LLM/API failures and provider transport issues.
 * - infrastructure: Playwright, CDP, browser, or WebSocket failures below the harness.
 * - harness: e2e scaffolding, synchronization, and trace collection failures.
 * - runtime: extension bridge or agent runtime failures.
 * - product: agent behavior or assertion failures.
 */
function classifyFailureEvidence(
  turns: AnalysisTraceTurn[],
  diagnostics: HarnessDiagnostic[] = [],
): E2EFailureEvidence {
  const providerSignals = [
    /\b(429|500|502|503|504)\b/,
    /\b(rate.?limit|too many requests|service unavailable|bad gateway|gateway timeout)\b/i,
    /\b(empty response|no response|model refused|content filter|api error|provider error)\b/i,
    /\b(ETIMEDOUT|ECONNREFUSED|fetch failed)\b/i,
    /\b(provider|llm|model|api|request)\b.{0,40}\b(timeout|timed out)\b/i,
  ];

  const infrastructureSignals = [
    /\b(CDP|Protocol error|WebSocket|Target closed|Session closed)\b/i,
    /\b(browser (?:has )?(?:disconnected|closed|crashed)|page crashed)\b/i,
    /\b(Execution context was destroyed|detached frame|frame was detached)\b/i,
  ];

  const harnessSignals = [
    /\b(test timeout|assertion failed|expect\(|beforeEach|afterEach)\b/i,
    /\b(no trace file|missing trace|workspace filter)\b/i,
  ];

  const runtimeSignals = [
    /\b(bridge disconnect|content script .* not .* respond|extension context invalidated)\b/i,
    /\b(tab (was )?closed|no active tab|tab not found|Cannot access)\b/i,
    /\b(navigation timeout|injecting content script|reinjection|chrome\.runtime)\b/i,
  ];

  let providerHits = 0;
  let infrastructureHits = 0;
  let harnessHits = 0;
  let runtimeHits = 0;
  const signals: string[] = [];
  let firstBadTurnRef = "-";

  for (const turn of turns) {
    const texts = [
      turn.llmContent || "",
      ...turn.toolResults.map(
        (result) => `${result.result} ${result.error || ""}`,
      ),
    ];

    for (const text of texts) {
      if (!text) continue;
      for (const pattern of providerSignals) {
        if (pattern.test(text)) {
          providerHits++;
          signals.push("provider:" + compactPrompt(text, 90));
        }
      }
      for (const pattern of infrastructureSignals) {
        if (pattern.test(text)) {
          infrastructureHits++;
          signals.push("infrastructure:" + compactPrompt(text, 90));
        }
      }
      for (const pattern of harnessSignals) {
        if (pattern.test(text)) {
          harnessHits++;
          signals.push("harness:" + compactPrompt(text, 90));
        }
      }
      for (const pattern of runtimeSignals) {
        if (pattern.test(text)) {
          runtimeHits++;
          signals.push("runtime:" + compactPrompt(text, 90));
        }
      }
    }

    if (
      firstBadTurnRef === "-" &&
      (turn.toolResults.some((result) => result.success === false) ||
        providerHits + infrastructureHits + harnessHits + runtimeHits > 0)
    ) {
      firstBadTurnRef = `S${turn.traceOrdinal ?? 1}-T${turn.turnNumber}`;
    }
  }

  for (const item of diagnostics) {
    if (item.severity === "warning" || item.severity === "error") {
      harnessHits++;
      signals.push(`harness:${item.message}`);
    }
  }

  const scored: Array<[NonNullable<FailureClass>, number]> = [
    ["infrastructure", infrastructureHits],
    ["provider", providerHits],
    ["runtime", runtimeHits],
    ["harness", harnessHits],
  ];
  const winner = scored
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])[0]?.[0];

  return {
    failureClass: winner ?? (turns.length > 0 ? "product" : "unknown"),
    firstBadTurnRef,
    signals: sortUnique(signals).slice(0, 6),
    diagnostics,
  };
}

function analyzeTraces(
  traceFiles: string[],
  sessionIndex: Map<string, TraceSession> = readTraceSessions(),
): TraceAnalysis {
  let totalCost = 0;
  let totalTurns = 0;
  let model: string | undefined;
  let pageInterpretationTurns = 0;
  const toolCounts: Record<string, number> = {};
  const allTurns: AnalysisTraceTurn[] = [];
  const runIds = new Set<string>();
  const sessionIds = new Set<string>();
  const prompts = new Set<string>();
  const skillsUsed = new Set<string>();
  const nodeSkills = new Map<string, { skillId: string; reason?: string }>();
  const diagnostics = createEmptyDiagnostics();

  for (let traceIndex = 0; traceIndex < traceFiles.length; traceIndex++) {
    const filePath = traceFiles[traceIndex];
    if (!existsSync(filePath)) continue;

    const entries = readTraceEntries(filePath);
    if (entries.length === 0) continue;

    totalTurns += entries.length;
    pageInterpretationTurns += countPageInterpretationTurns(entries);
    model ||= entries.find((entry) => entry.llmRequest?.model)?.llmRequest
      ?.model;

    for (const entry of entries) {
      const cost = entry.llmResponse?.usage?.cost;
      if (typeof cost === "number") totalCost += cost;
    }

    const sessionId = getSessionIdFromTraceFile(filePath, entries);
    sessionIds.add(sessionId);

    const session =
      sessionIndex.get(sessionId) ??
      ({
        sessionId,
        startTime: entries[0]?.timestamp ?? 0,
        endTime: entries.at(-1)?.timestamp ?? entries[0]?.timestamp ?? 0,
        query: "",
        startUrl: entries[0]?.snapshot?.url ?? "",
        outcome: "completed",
        turnCount: entries.length,
        summary: "",
        metrics: null,
      } satisfies TraceSession);

    if (session.query?.trim()) {
      prompts.add(session.query);
    }

    mergeDiagnostics(diagnostics, computeSessionDiagnostics(session, entries));

    const turns: AnalysisTraceTurn[] = readTrace(filePath).map((turn) => ({
      ...turn,
      traceOrdinal: traceIndex + 1,
    }));
    allTurns.push(...turns);
    for (const turn of turns) {
      for (const toolCall of turn.toolCalls) {
        toolCounts[toolCall.name] = (toolCounts[toolCall.name] || 0) + 1;
      }
    }

    const runId = extractRunIdFromTraceFile(filePath);
    if (runId) {
      runIds.add(runId);
      const skillSummary = readSkillSummaryForRun(runId);
      for (const skillId of skillSummary?.skillIds || []) {
        skillsUsed.add(skillId);
      }
      for (const item of skillSummary?.nodeSkills || []) {
        nodeSkills.set(item.nodeId, {
          skillId: item.skillId,
          ...(item.reason ? { reason: item.reason } : {}),
        });
      }
    }
  }

  const repeatedTools: string[] = [];
  for (let i = 1; i < allTurns.length; i++) {
    const previous = allTurns[i - 1].toolCalls
      .map((tool) => tool.name)
      .join(",");
    const current = allTurns[i].toolCalls.map((tool) => tool.name).join(",");
    if (previous && previous === current && !repeatedTools.includes(previous)) {
      repeatedTools.push(previous);
    }
  }

  const formMetrics = collectFormTraceMetrics(traceFiles);
  const hasFormSkill =
    skillsUsed.has("structured-form-fill") ||
    skillsUsed.has("progressive-repeatable-form") ||
    skillsUsed.has("multi-step-form-wizard");

  return {
    turns: totalTurns,
    cost: totalCost,
    traceCount: traceFiles.length,
    runTraceCount: 0,
    pageInterpretationTurns,
    promptUsed: compactPrompt([...prompts].join(" / ")),
    toolCounts,
    repeatedTools,
    model,
    turnDetails: allTurns,
    runIds: [...runIds],
    sessionIds: [...sessionIds],
    skillsUsed: [...skillsUsed].sort(),
    nodeSkills: [...nodeSkills.entries()].map(([nodeId, value]) => ({
      nodeId,
      skillId: value.skillId,
      ...(value.reason ? { reason: value.reason } : {}),
    })),
    diagnostics,
    harnessDiagnostics: [],
    failureClass: null,
    failureEvidence: null,
    formMetrics: hasFormSkill ? formMetrics : null,
  };
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "-";
  if (cost < 0.001) return `$${cost.toFixed(5)}`;
  return `$${cost.toFixed(3)}`;
}

function padRight(value: string, length: number): string {
  return value.length >= length
    ? value
    : value + " ".repeat(length - value.length);
}

function padLeft(value: string, length: number): string {
  return value.length >= length
    ? value
    : " ".repeat(length - value.length) + value;
}

function formatCounterSummary(
  counts: Partial<Record<string, number>>,
  maxItems: number = 3,
): string {
  const items = Object.entries(counts)
    .filter(([, value]) => typeof value === "number" && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems);
  if (items.length === 0) return "none";
  return items.map(([key, value]) => `${key}(${value})`).join(", ");
}

function formatFormRubric(metrics: FormTraceMetrics): string {
  const outcome = metrics.outcome;
  return [
    outcome.filledRequiredFields ? "fields" : "fields?",
    outcome.handledConditionalFields ? "conditional" : "conditional?",
    outcome.advancedAllSteps ? "steps" : "steps?",
    outcome.verifiedReview ? "review" : "review?",
    outcome.submitted ? "submit" : "submit?",
    outcome.detectedConfirmation ? "confirmation" : "confirmation?",
  ].join(", ");
}

function normalizeTraceArtifacts(
  input: string[] | TraceArtifactBundle,
): Pick<
  TestRecord,
  "traceFiles" | "runTraceFiles" | "runIds" | "harnessDiagnostics"
> {
  if (Array.isArray(input)) {
    return {
      traceFiles: input,
      runTraceFiles: [],
      runIds: [],
      harnessDiagnostics: [],
    };
  }

  return {
    traceFiles: input.traceFiles,
    runTraceFiles: input.runTraceFiles,
    runIds: input.runIds,
    harnessDiagnostics: input.diagnostics,
  };
}

function mergeRunIds(left: string[], right: string[]): string[] {
  return sortUnique([...left, ...right]);
}

function buildReportIndexEntry(
  reportPath: string,
  generatedAt: Date,
  analyses: Array<{ rec: TestRecord; analysis: TraceAnalysis }>,
): E2EReportIndexEntry {
  return {
    path: reportPath,
    generatedAt: generatedAt.toISOString(),
    caseCount: analyses.length,
    traceFiles: sortUnique(analyses.flatMap(({ rec }) => rec.traceFiles)),
    runTraceFiles: sortUnique(analyses.flatMap(({ rec }) => rec.runTraceFiles)),
  };
}

function buildMarkdownReport(
  analyses: Array<{ rec: TestRecord; analysis: TraceAnalysis }>,
  runMetadata: RunMetadata | null,
  now: Date = new Date(),
): string {
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toISOString().split("T")[1].split(".")[0] + " UTC";
  const passedCount = analyses.filter(({ rec }) => rec.passed).length;
  const failedCount = analyses.filter(({ rec }) => rec.passed === false).length;

  const suiteDiagnostics = analyses.reduce(
    (acc, { analysis }) => mergeDiagnostics(acc, analysis.diagnostics),
    createEmptyDiagnostics(),
  );

  const provider = runMetadata?.provider ?? "unknown";
  const lane = runMetadata?.lane ?? "unknown";
  const executorModel = runMetadata?.configuredExecutorModel ?? "default";
  const diagnosticMode = runMetadata?.diagnosticMode === true ? "on" : "off";

  const lines: string[] = [];
  lines.push("# E2E Final Report");
  lines.push("");
  lines.push(`Date: ${dateStr} ${timeStr}`);
  lines.push(
    `Scope: ${analyses.length} case(s); lane=${lane}; provider=${provider}; executor=${executorModel}; diagnostic=${diagnosticMode}`,
  );
  lines.push(
    `Overall result: ${passedCount}/${analyses.length} passed${failedCount > 0 ? `, ${failedCount} failed` : ""}`,
  );
  lines.push("");
  lines.push(
    "| Case | Success | Turns | Perceptions | Trace refs | First bad | Failure | Prompt used |",
  );
  lines.push(
    "|------|---------|------:|------------:|------------|-----------|---------|-------------|",
  );
  for (const { rec, analysis } of analyses) {
    const traceRefs = `${analysis.traceCount} trace(s), ${analysis.runTraceCount} run(s)`;
    lines.push(
      `| ${rec.name} | ${rec.passed ? "Yes" : rec.passed === false ? "No" : "Unknown"} | ${analysis.turns} | ${analysis.pageInterpretationTurns} | ${traceRefs} | ${analysis.failureEvidence?.firstBadTurnRef ?? "-"} | ${analysis.failureClass ?? "-"} | ${analysis.promptUsed} |`,
    );
  }
  lines.push("");
  lines.push("## Metric Definitions");
  lines.push("");
  lines.push(
    "- `Turns`: Total recorded trace turns across the trace file(s) for that case.",
  );
  lines.push(
    "- `Perceptions`: Turns where the recorded trace input included `Page Interpretation`.",
  );
  lines.push(
    "- `Trace refs`: Compact count of agent trace files and orchestrator run trace files referenced by the case.",
  );
  lines.push(
    "- `First bad`: Abbreviated `S<n>-T<m>` reference to the first trace session and turn with failure evidence.",
  );
  lines.push(
    "- `Failure`: Conservative failure class inferred from trace, run, and harness diagnostics.",
  );
  lines.push(
    "- `Success`: Whether the case completed successfully in the run.",
  );
  lines.push(
    "- `Form metrics`: For form-skill traces, field writes count text/select/checkbox writes, validation errors count observed inline/server feedback, corrections count field writes after validation feedback, rework counts stagnation/widening signals, and submit confidence ranges from 0 to 1.",
  );

  const failureAnalyses = analyses.filter(
    ({ rec, analysis }) => rec.passed === false || analysis.failureEvidence,
  );
  if (failureAnalyses.length > 0) {
    lines.push("");
    lines.push("## Failure Evidence");
    for (const { rec, analysis } of failureAnalyses) {
      lines.push("");
      lines.push(`### ${rec.name}`);
      if (!analysis.failureEvidence) {
        lines.push("- Class: unknown");
        lines.push("- First bad turn: -");
        continue;
      }
      lines.push(`- Class: ${analysis.failureEvidence.failureClass}`);
      lines.push(
        `- First bad turn: ${analysis.failureEvidence.firstBadTurnRef}`,
      );
      lines.push(
        `- Trace references: ${analysis.traceCount} agent trace(s), ${analysis.runTraceCount} run trace(s), ${analysis.runIds.length} run ID(s).`,
      );
      if (analysis.failureEvidence.signals.length > 0) {
        lines.push(
          `- Signals: ${analysis.failureEvidence.signals.join(" / ")}`,
        );
      }
      const warnings = analysis.failureEvidence.diagnostics.filter(
        (item) => item.severity !== "info",
      );
      if (warnings.length > 0) {
        lines.push(
          `- Harness diagnostics: ${warnings.map((item) => item.message).join(" / ")}`,
        );
      }
    }
  }

  const formAnalyses = analyses.filter(({ analysis }) => analysis.formMetrics);
  if (formAnalyses.length > 0) {
    lines.push("");
    lines.push("## Form Metrics");
    lines.push("");
    lines.push(
      "| Case | Field writes | Step transitions | Validation errors | Failed submits | Corrections | Rework | Submit confidence | Recovery | Rubric |",
    );
    lines.push(
      "|------|-------------:|-----------------:|------------------:|---------------:|------------:|-------:|------------------:|----------|--------|",
    );
    for (const { rec, analysis } of formAnalyses) {
      const metrics = analysis.formMetrics;
      if (!metrics) continue;
      lines.push(
        `| ${rec.name} | ${metrics.fieldWriteCount} | ${metrics.stepTransitionCount} | ${metrics.validationErrorCount} | ${metrics.failedSubmitCount} | ${metrics.correctedFieldCount} | ${metrics.reworkStagnationCount} | ${metrics.finalSubmitConfidence.toFixed(2)} | ${metrics.recoverySuccess ? "Yes" : "No"} | ${formatFormRubric(metrics)} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Stability Notes");
  lines.push("");
  lines.push(
    `- Perception path mix: structured ${suiteDiagnostics.structuredPerceptionTurns}, VL screenshot ${suiteDiagnostics.vlScreenshotTurns}, element-only ${suiteDiagnostics.elementOnlyTurns}.`,
  );
  lines.push(
    `- Cached perception: ${suiteDiagnostics.perceptionCacheHits}/${suiteDiagnostics.perceptionCalls} calls; degraded perception turns: ${suiteDiagnostics.degradedPerceptionTurns}.`,
  );
  lines.push(
    `- Freshness hotspots: ${formatCounterSummary(suiteDiagnostics.perceptionFreshness)}.`,
  );
  lines.push(
    `- Fallback hotspots: ${formatCounterSummary(suiteDiagnostics.perceptionFallbacks)}.`,
  );
  lines.push(
    `- Screenshot status mix: ${formatCounterSummary(suiteDiagnostics.perceptionScreenshots)}.`,
  );

  return lines.join("\n") + "\n";
}

class SuiteReport {
  private records: TestRecord[] = [];
  private printed = false;
  private runMetadata: RunMetadata | null = null;

  setRunMetadata(metadata: RunMetadata): void {
    this.runMetadata = metadata;
  }

  record(
    name: string,
    passed: boolean | null,
    durationMs: number,
    traceArtifacts: string[] | TraceArtifactBundle,
  ): void {
    this.records.push({
      name,
      passed,
      durationMs,
      ...normalizeTraceArtifacts(traceArtifacts),
    });
  }

  printSummary(): void {
    if (this.printed || this.records.length === 0) return;
    this.printed = true;

    const sessionIndex = readTraceSessions();
    const analyses = this.records.map((rec) => {
      const analysis = analyzeTraces(rec.traceFiles, sessionIndex);
      analysis.runTraceCount = rec.runTraceFiles.length;
      analysis.runIds = mergeRunIds(analysis.runIds, rec.runIds);
      analysis.harnessDiagnostics = rec.harnessDiagnostics;
      if (rec.passed === false) {
        const evidence = classifyFailureEvidence(
          analysis.turnDetails,
          rec.harnessDiagnostics,
        );
        analysis.failureClass = evidence.failureClass;
        analysis.failureEvidence = evidence;
      }
      return { rec, analysis };
    });

    this.printConsoleTable(analyses);
    this.writeMarkdownReport(analyses);
  }

  private printConsoleTable(
    analyses: Array<{ rec: TestRecord; analysis: TraceAnalysis }>,
  ): void {
    const COL_NAME = 26;
    const COL_RESULT = 6;
    const COL_TURNS = 5;
    const COL_COST = 9;
    const COL_TIME = 8;
    const LINE_WIDTH = 62;

    const border = "=".repeat(LINE_WIDTH);
    const divider = "-".repeat(LINE_WIDTH);

    let totalCost = 0;
    let totalDuration = 0;
    let passCount = 0;

    const lines: string[] = [];
    lines.push("");
    lines.push(`  ${border}`);
    lines.push("    E2E SUITE REPORT");
    lines.push(`  ${border}`);
    lines.push(
      `  ${padRight("Test", COL_NAME)}  ${padRight("Result", COL_RESULT)}  ${padLeft("Turns", COL_TURNS)}  ${padLeft("Cost", COL_COST)}  ${padLeft("Time", COL_TIME)}`,
    );
    lines.push(`  ${divider}`);

    for (const { rec, analysis } of analyses) {
      totalCost += analysis.cost;
      totalDuration += rec.durationMs;
      if (rec.passed) passCount++;

      const result = rec.passed == null ? "UNK" : rec.passed ? "PASS" : "FAIL";
      lines.push(
        `  ${padRight(rec.name, COL_NAME)}  ${padRight(result, COL_RESULT)}  ${padLeft(String(analysis.turns), COL_TURNS)}  ${padLeft(formatCost(analysis.cost), COL_COST)}  ${padLeft(formatDuration(rec.durationMs), COL_TIME)}`,
      );
    }

    lines.push(`  ${divider}`);
    lines.push(
      `  Total: ${passCount}/${this.records.length} passed  |  ${formatCost(totalCost)}  |  ${formatDuration(totalDuration)}`,
    );
    lines.push(`  ${border}`);
    lines.push("");

    console.log(lines.join("\n"));
  }

  private writeMarkdownReport(
    analyses: Array<{ rec: TestRecord; analysis: TraceAnalysis }>,
  ): void {
    const reportsDir = resolve(PROJECT_ROOT, ".artifacts", "e2e");
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

    const generatedAt = new Date();
    const timestamp = generatedAt
      .toISOString()
      .replace(/[:.]/g, "-");
    const reportPath = resolve(reportsDir, `e2e-report-${timestamp}.md`);
    const markdown = buildMarkdownReport(analyses, this.runMetadata, generatedAt);

    writeFileSync(reportPath, markdown, "utf-8");
    this.writeReportIndex(reportsDir, reportPath, generatedAt, analyses);
    console.log(`\n[report] Written to ${reportPath}`);
  }

  private writeReportIndex(
    reportsDir: string,
    reportPath: string,
    generatedAt: Date,
    analyses: Array<{ rec: TestRecord; analysis: TraceAnalysis }>,
  ): void {
    const indexPath = resolve(reportsDir, "index.json");
    let reports: E2EReportIndexEntry[] = [];
    if (existsSync(indexPath)) {
      try {
        const parsed = JSON.parse(readFileSync(indexPath, "utf-8"));
        if (Array.isArray(parsed?.reports)) {
          reports = parsed.reports.filter(
            (item: any) =>
              typeof item?.path === "string" &&
              typeof item?.generatedAt === "string",
          );
        }
      } catch {
        reports = [];
      }
    }

    const entry = buildReportIndexEntry(reportPath, generatedAt, analyses);
    const nextReports = [
      entry,
      ...reports.filter((item) => item.path !== reportPath),
    ].slice(0, 20);

    writeFileSync(
      indexPath,
      JSON.stringify(
        {
          latest: entry,
          reports: nextReports,
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  }
}

export const __testOnly = {
  analyzeTraces,
  buildMarkdownReport,
  buildReportIndexEntry,
  classifyFailureEvidence,
  compactPrompt,
  countPageInterpretationTurns,
  createEmptyDiagnostics,
  mergeDiagnostics,
  normalizeTraceArtifacts,
};

export const suiteReport = new SuiteReport();

process.on("beforeExit", () => {
  suiteReport.printSummary();
});

process.on("exit", () => {
  suiteReport.printSummary();
});
