import type { TraceEntry, TraceEvent } from "../../types/traces";
import type { RunTraceEvent } from "../../utils/run-trace";
import { redactTracePayload } from "../../utils/trace-protection";
import type { SessionLogEntry } from "../store/types";
import { analyzeTraceSession } from "./analyze";
import type {
  InvestigationFinding,
  TraceAnalysisInput,
  TraceInvestigation,
} from "./types";

export interface TraceInvestigationReportOptions {
  maxFindings?: number;
  maxTurns?: number;
  turnWindow?: number;
  maxSnippetLength?: number;
}

function clip(value: string | null | undefined, maxLength: number): string {
  if (!value) return "";
  const redacted = redactTracePayload(value, { mode: "export" });
  return redacted.length > maxLength
    ? `${redacted.slice(0, maxLength)}...[truncated ${redacted.length - maxLength} chars]`
    : redacted;
}

function stringify(value: unknown, maxLength: number): string {
  try {
    return clip(
      JSON.stringify(redactTracePayload(value, { mode: "export" })),
      maxLength,
    );
  } catch {
    return String(value);
  }
}

function formatEvent(event: TraceEvent, maxLength: number): string {
  return `${event.type}: ${stringify(event.data, maxLength)}`;
}

function formatRunEvent(event: RunTraceEvent, maxLength: number): string {
  return `${event.type}${event.role ? ` (${event.role})` : ""}: ${stringify(
    event.data ?? {},
    maxLength,
  )}`;
}

function findingTurns(findings: InvestigationFinding[]): Set<number> {
  const turns = new Set<number>();
  for (const finding of findings) {
    if (typeof finding.firstTurn === "number") turns.add(finding.firstTurn);
    for (const evidence of finding.evidence) {
      if (typeof evidence.turnNumber === "number")
        turns.add(evidence.turnNumber);
    }
  }
  return turns;
}

function selectRelevantTurns(
  entries: TraceEntry[],
  investigation: TraceInvestigation,
  options: Required<
    Pick<TraceInvestigationReportOptions, "maxTurns" | "turnWindow">
  >,
): TraceEntry[] {
  if (entries.length <= options.maxTurns) return entries;

  const selected = new Set<number>();
  const anchorTurns = findingTurns(investigation.findings);
  if (investigation.firstBadTurn != null)
    anchorTurns.add(investigation.firstBadTurn);

  for (const turn of anchorTurns) {
    for (
      let candidate = turn - options.turnWindow;
      candidate <= turn + options.turnWindow;
      candidate++
    ) {
      selected.add(candidate);
    }
  }

  if (selected.size === 0) {
    for (const entry of entries.slice(0, Math.min(3, entries.length))) {
      selected.add(entry.turnNumber);
    }
    selected.add(entries[entries.length - 1].turnNumber);
  }

  return entries
    .filter((entry) => selected.has(entry.turnNumber))
    .slice(0, options.maxTurns);
}

function appendFinding(lines: string[], finding: InvestigationFinding): void {
  lines.push(
    `- [${finding.severity}] ${finding.title} (${finding.category}, confidence ${Math.round(
      finding.confidence * 100,
    )}%)`,
  );
  lines.push(`  ${finding.summary}`);
  if (finding.firstTurn != null) {
    lines.push(`  First turn: T${finding.firstTurn}`);
  }
  if (finding.evidence.length > 0) {
    lines.push(
      `  Evidence: ${finding.evidence
        .map((evidence) =>
          [
            evidence.label,
            evidence.turnNumber != null ? `T${evidence.turnNumber}` : "",
            evidence.eventType ? `event=${evidence.eventType}` : "",
            evidence.toolCallId ? `tool=${evidence.toolCallId}` : "",
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join("; ")}`,
    );
  }
}

function appendTurn(
  lines: string[],
  entry: TraceEntry,
  runEvents: RunTraceEvent[],
  logs: SessionLogEntry[],
  maxSnippetLength: number,
): void {
  lines.push(`### Turn ${entry.turnNumber}`);
  lines.push(`- Turn ID: ${entry.turnId ?? "(missing)"}`);
  lines.push(`- URL: ${entry.snapshot?.url ?? "(unknown)"}`);
  lines.push(
    `- Model: ${entry.llmRequest?.model ?? "(unknown)"}${entry.llmRequest?.modelTier ? ` (${entry.llmRequest.modelTier})` : ""}`,
  );
  lines.push(`- Finish: ${entry.llmResponse?.finishReason ?? "(unknown)"}`);

  const context = entry.llmRequest?.contextMetrics;
  if (context) {
    lines.push(
      `- Context: ${Math.round((context.utilization ?? 0) * 100)}% utilization, ${context.droppedMessageCount ?? 0} dropped messages, compression ${context.compressionLevel}`,
    );
  }

  if (entry.progressState) {
    lines.push(
      `- Progress: stagnant=${entry.progressState.stagnantTurns ?? 0}, signal=${entry.progressState.signal ?? "none"}`,
    );
  }

  if (entry.llmResponse?.content) {
    lines.push(
      `- LLM content: ${clip(entry.llmResponse.content, maxSnippetLength)}`,
    );
  }

  const toolCalls = entry.llmResponse?.toolCalls ?? [];
  if (toolCalls.length > 0) {
    lines.push("- Tool calls:");
    for (const call of toolCalls) {
      lines.push(
        `  - ${call.function.name} ${clip(call.function.arguments, maxSnippetLength)}`,
      );
    }
  }

  if ((entry.toolExecutions ?? []).length > 0) {
    lines.push("- Tool executions:");
    for (const tool of entry.toolExecutions ?? []) {
      lines.push(
        `  - ${tool.success ? "ok" : "failed"} ${tool.toolName} (${tool.durationMs}ms): ${clip(
          tool.error || tool.result,
          maxSnippetLength,
        )}`,
      );
    }
  }

  if ((entry.events ?? []).length > 0) {
    lines.push("- Agent events:");
    for (const event of entry.events ?? []) {
      lines.push(`  - ${formatEvent(event, maxSnippetLength)}`);
    }
  }

  if (entry.perception) {
    lines.push(
      `- Perception: mode=${entry.perception.mode ?? "unknown"}, source=${entry.perception.source ?? "unknown"}, screenshot=${entry.perception.screenshotStatus ?? "unknown"}, cached=${entry.perception.cached}`,
    );
    lines.push(
      `  Interpretation: ${clip(entry.perception.interpretation, maxSnippetLength)}`,
    );
  }

  const turnRunEvents = runEvents.filter(
    (event) => event.turn === entry.turnNumber,
  );
  if (turnRunEvents.length > 0) {
    lines.push("- Run events:");
    for (const event of turnRunEvents.slice(0, 6)) {
      lines.push(`  - ${formatRunEvent(event, maxSnippetLength)}`);
    }
  }

  const turnLogs = logs.filter((log) => {
    const turn = log.data?.turn ?? log.data?.turnNumber;
    return turn === entry.turnNumber;
  });
  if (turnLogs.length > 0) {
    lines.push("- Logs:");
    for (const log of turnLogs.slice(0, 6)) {
      lines.push(
        `  - ${log.lvl} ${log.src}/${log.cat}: ${clip(log.msg, maxSnippetLength)}`,
      );
    }
  }
}

export function buildTraceInvestigationReport(
  input: TraceAnalysisInput,
  options: TraceInvestigationReportOptions = {},
): string {
  const investigation = analyzeTraceSession(input);
  const maxFindings = options.maxFindings ?? 8;
  const maxTurns = options.maxTurns ?? 10;
  const turnWindow = options.turnWindow ?? 1;
  const maxSnippetLength = options.maxSnippetLength ?? 1200;
  const entries = selectRelevantTurns(input.entries, investigation, {
    maxTurns,
    turnWindow,
  });
  const lines: string[] = [];

  lines.push("# Trace Investigation Context");
  lines.push("");
  lines.push(`Session: ${input.session.sessionId}`);
  if (input.session.runId) lines.push(`Run: ${input.session.runId}`);
  lines.push(`Outcome: ${input.session.outcome}`);
  lines.push(`Task: ${clip(input.session.query, maxSnippetLength)}`);
  lines.push(`Start URL: ${input.session.startUrl || "(unknown)"}`);
  lines.push(`Turns: ${input.entries.length || input.session.turnCount || 0}`);
  lines.push("");

  lines.push("## Diagnosis");
  lines.push(`Headline: ${investigation.headline}`);
  lines.push(`Likely class: ${investigation.likelyFailureClass}`);
  lines.push(
    `First bad turn: ${investigation.firstBadTurn == null ? "(none)" : `T${investigation.firstBadTurn}`}`,
  );
  lines.push(`Recommended action: ${investigation.recommendedAction}`);
  lines.push("");

  lines.push("## Metrics");
  lines.push(
    `Productive turns: ${investigation.metrics.productiveTurns}/${investigation.metrics.turnCount}`,
  );
  lines.push(`Tool failure turns: ${investigation.metrics.toolFailureTurns}`);
  lines.push(
    `Degraded perception: ${investigation.metrics.degradedPerceptionTurns}/${investigation.metrics.perceptionTurns}`,
  );
  lines.push(`Context hot turns: ${investigation.metrics.contextHotTurns}`);
  lines.push(`Replans: ${investigation.metrics.replanCount}`);
  lines.push(`Done rejections: ${investigation.metrics.doneRejectionCount}`);
  if (investigation.metrics.totalTokens > 0) {
    lines.push(`Tokens: ${investigation.metrics.totalTokens}`);
  }
  if (investigation.metrics.totalCost > 0) {
    lines.push(`Cost: ${investigation.metrics.totalCost}`);
  }
  lines.push("");

  lines.push("## Findings");
  if (investigation.findings.length === 0) {
    lines.push("- No structured findings detected.");
  } else {
    for (const finding of investigation.findings.slice(0, maxFindings)) {
      appendFinding(lines, finding);
    }
  }
  lines.push("");

  lines.push("## Evidence Turns");
  for (const entry of entries) {
    appendTurn(
      lines,
      entry,
      input.runEvents ?? [],
      input.logs ?? [],
      maxSnippetLength,
    );
    lines.push("");
  }

  const errorLogs = (input.logs ?? []).filter((log) =>
    ["error", "fatal"].includes(String(log.lvl).toLowerCase()),
  );
  if (errorLogs.length > 0) {
    lines.push("## Error Logs");
    for (const log of errorLogs.slice(0, 10)) {
      lines.push(
        `- ${log.ts} ${log.src}/${log.cat}: ${clip(log.msg, maxSnippetLength)}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}
