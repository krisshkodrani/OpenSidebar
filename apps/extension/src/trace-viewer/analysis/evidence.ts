import type { TraceEntry, TraceEvent } from "../../types/traces";
import type { RunTraceEvent } from "../../utils/run-trace";
import type { SessionLogEntry } from "../store/types";
import type {
  InvestigationSeverity,
  TraceAnalysisInput,
  TraceEvidenceSignal,
  TraceEvidenceTurn,
} from "./types";
import {
  STAGNANT_PROGRESS_TURN_THRESHOLD,
  isContextHotTurn,
  isDegradedPerceptionTurn,
} from "./analyze";
import { compareToolSequence, sameSnapshot } from "./repeat-actions";

const SEVERITY_RANK: Record<InvestigationSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function eventDetail(event: TraceEvent, keys: string[]): string | undefined {
  const data = asRecord(event.data);
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
    if (typeof value === "boolean") return String(value);
  }
  return undefined;
}

function runEventDetail(event: RunTraceEvent): string | undefined {
  const data = asRecord(event.data);
  return (
    stringValue(data.reason) ??
    stringValue(data.error) ??
    stringValue(data.status) ??
    stringValue(data.message) ??
    undefined
  );
}

function logTurn(log: SessionLogEntry): number | null {
  const data = asRecord(log.data);
  return numberValue(data.turnNumber) ?? numberValue(data.turn) ?? null;
}

function highestSeverity(
  signals: TraceEvidenceSignal[],
): InvestigationSeverity {
  return signals.reduce<InvestigationSeverity>(
    (highest, signal) =>
      SEVERITY_RANK[signal.severity] < SEVERITY_RANK[highest]
        ? signal.severity
        : highest,
    "info",
  );
}

function signalSummary(signals: TraceEvidenceSignal[]): string {
  const primary =
    signals.find((signal) => signal.severity === "error") ??
    signals.find((signal) => signal.severity === "warning") ??
    signals[0];
  if (!primary) return "No high-signal evidence on this turn";
  const remaining = signals.length - 1;
  return remaining > 0 ? `${primary.label} +${remaining} more` : primary.label;
}

function pushSignal(
  signals: TraceEvidenceSignal[],
  signal: TraceEvidenceSignal,
): void {
  signals.push(signal);
}

export function buildTraceEvidenceSignalsForTurn(
  entry: TraceEntry,
  previous: TraceEntry | undefined,
): TraceEvidenceSignal[] {
  const signals: TraceEvidenceSignal[] = [];

  for (const tool of entry.toolExecutions ?? []) {
    if (!tool.success) {
      pushSignal(signals, {
        id: `tool-${tool.toolCallId || signals.length}`,
        source: "tool",
        category: "tool_execution",
        severity: "error",
        label: `Tool failed: ${tool.toolName}`,
        detail: tool.error || tool.result,
        target: "turns",
      });
    }
  }

  const repeatKind = compareToolSequence(previous, entry);
  if (repeatKind && sameSnapshot(previous, entry)) {
    pushSignal(signals, {
      id: "repeat-loop",
      source: "progress",
      category: "loop",
      severity: "warning",
      label:
        repeatKind === "exact"
          ? "Repeated action loop"
          : "Near repeated action loop",
      detail:
        repeatKind === "exact"
          ? `Same tool sequence and arguments as turn ${previous?.turnNumber}`
          : `Near-identical tool sequence as turn ${previous?.turnNumber}`,
      target: "turns",
    });
  }

  if (
    (entry.progressState?.stagnantTurns ?? 0) >=
      STAGNANT_PROGRESS_TURN_THRESHOLD ||
    Boolean(entry.progressState?.signal)
  ) {
    pushSignal(signals, {
      id: "stale-progress",
      source: "progress",
      category: "loop",
      severity: "warning",
      label: "Stale progress",
      detail:
        entry.progressState?.signal ??
        `${entry.progressState?.stagnantTurns ?? 0} stagnant turns`,
      target: "turns",
    });
  }

  for (const event of entry.events ?? []) {
    if (event.type === "done_rejected") {
      pushSignal(signals, {
        id: `event-${event.type}-${signals.length}`,
        source: "agent_event",
        category: "completion",
        severity: "warning",
        label: "Completion rejected",
        detail: eventDetail(event, ["reason", "rejections"]),
        target: "turns",
      });
    } else if (event.type === "plan_monitor") {
      const alignment = stringValue(asRecord(event.data).alignment);
      if (alignment === "blocked" || alignment === "deviated") {
        pushSignal(signals, {
          id: `event-${event.type}-${signals.length}`,
          source: "agent_event",
          category: "planning",
          severity: "warning",
          label: `Plan ${alignment}`,
          detail: eventDetail(event, ["reason", "blocker"]),
          target: "turns",
        });
      }
    } else if (event.type === "plan_replan") {
      pushSignal(signals, {
        id: `event-${event.type}-${signals.length}`,
        source: "agent_event",
        category: "planning",
        severity: "info",
        label: "Replan",
        detail: eventDetail(event, ["reason", "replanNumber"]),
        target: "turns",
      });
    } else if (
      event.type === "circuit_breaker" ||
      event.type === "safety_gate_blocked"
    ) {
      pushSignal(signals, {
        id: `event-${event.type}-${signals.length}`,
        source: "agent_event",
        category: event.type === "circuit_breaker" ? "loop" : "tool_execution",
        severity: "error",
        label:
          event.type === "circuit_breaker"
            ? "Circuit breaker"
            : "Safety gate blocked",
        detail: eventDetail(event, ["reason", "tool", "phase"]),
        target: "turns",
      });
    }
  }

  if (
    entry.perception &&
    isDegradedPerceptionTurn(entry)
  ) {
    pushSignal(signals, {
      id: "degraded-perception",
      source: "perception",
      category: "perception",
      severity: "warning",
      label: "Degraded perception",
      detail:
        entry.perception.fallbackReason ??
        entry.perception.screenshotStatus ??
        entry.perception.mode,
      target: "perception",
    });
  }

  if (isContextHotTurn(entry)) {
    const metrics = entry.llmRequest.contextMetrics;
    pushSignal(signals, {
      id: "context-pressure",
      source: "context",
      category: "context",
      severity: "warning",
      label: "Context pressure",
      detail: `${Math.round((metrics?.utilization ?? 0) * 100)}% used, ${metrics?.droppedMessageCount ?? 0} dropped`,
      target: "turns",
    });
  }

  if (
    entry.llmResponse?.actualModel &&
    entry.llmResponse.actualModel !== entry.llmRequest?.model
  ) {
    pushSignal(signals, {
      id: "model-failover",
      source: "model",
      category: "model_provider",
      severity: "info",
      label: "Model/provider failover",
      detail: `${entry.llmRequest.model} -> ${entry.llmResponse.actualModel}`,
      target: "turns",
    });
  }

  return signals;
}

function collectRunSignals(
  turnNumber: number,
  runEvents: RunTraceEvent[],
): TraceEvidenceSignal[] {
  return runEvents
    .filter((event) => event.turn === turnNumber)
    .flatMap((event, index): TraceEvidenceSignal[] => {
      const text =
        `${event.type} ${JSON.stringify(event.data ?? {})}`.toLowerCase();
      if (
        text.includes("verifier") &&
        (text.includes("reject") || text.includes("fail"))
      ) {
        return [
          {
            id: `run-${event.type}-${index}`,
            source: "run_event",
            category: "verification",
            severity: "warning",
            label: "Verifier rejected progress",
            detail: runEventDetail(event),
            target: "turns",
          },
        ];
      }
      if (
        event.type.includes("rebind") ||
        event.type.includes("coordination")
      ) {
        return [
          {
            id: `run-${event.type}-${index}`,
            source: "run_event",
            category: "planning",
            severity: event.type.includes("rejected") ? "warning" : "info",
            label: event.type.replace(/_/g, " "),
            detail: runEventDetail(event),
            target: "turns",
          },
        ];
      }
      return [];
    });
}

function collectLogSignals(
  turnNumber: number,
  logs: SessionLogEntry[],
): TraceEvidenceSignal[] {
  return logs
    .map((log, index) => ({ log, index }))
    .filter(({ log }) => logTurn(log) === turnNumber)
    .filter(({ log }) =>
      ["error", "fatal", "warn", "warning"].includes(
        String(log.lvl).toLowerCase(),
      ),
    )
    .map(({ log, index }) => ({
      id: `log-${index}`,
      source: "log" as const,
      category: "trace_integrity" as const,
      severity: ["error", "fatal"].includes(String(log.lvl).toLowerCase())
        ? ("error" as const)
        : ("warning" as const),
      label: `${log.lvl} log`,
      detail: log.msg,
      target: "logs" as const,
    }));
}

export function buildTraceEvidenceTimeline(
  input: TraceAnalysisInput,
): TraceEvidenceTurn[] {
  const runEvents = input.runEvents ?? [];
  const logs = input.logs ?? [];
  const turns: TraceEvidenceTurn[] = [];

  for (let index = 0; index < input.entries.length; index++) {
    const entry = input.entries[index];
    const signals = [
      ...buildTraceEvidenceSignalsForTurn(entry, input.entries[index - 1]),
      ...collectRunSignals(entry.turnNumber, runEvents),
      ...collectLogSignals(entry.turnNumber, logs),
    ].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

    if (signals.length === 0) continue;

    turns.push({
      sessionId: entry.sessionId,
      turnNumber: entry.turnNumber,
      turnId: entry.turnId,
      url: entry.snapshot?.url,
      title: entry.snapshot?.title,
      severity: highestSeverity(signals),
      summary: signalSummary(signals),
      signals,
    });
  }

  if (turns.length === 0 && input.session.outcome !== "completed") {
    const lastEntry = input.entries[input.entries.length - 1];
    if (lastEntry) {
      turns.push({
        sessionId: lastEntry.sessionId,
        turnNumber: lastEntry.turnNumber,
        turnId: lastEntry.turnId,
        url: lastEntry.snapshot?.url,
        title: lastEntry.snapshot?.title,
        severity: "info",
        summary: `Session ended as ${input.session.outcome}`,
        signals: [
          {
            id: "session-outcome",
            source: "progress",
            category: "trace_integrity",
            severity: "info",
            label: `Outcome: ${input.session.outcome}`,
            detail: input.session.failureDetail,
            target: "turns",
          },
        ],
      });
    }
  }

  return turns;
}
