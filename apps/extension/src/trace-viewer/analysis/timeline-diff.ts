import type { TraceEntry } from "../../types/traces";
import type {
  InvestigationSeverity,
  TraceTimelineDiff,
  TraceTimelineDiffCategory,
  TraceTimelineDiffInput,
  TraceTimelineDiffOptions,
  TraceTurnDiff,
  TraceTurnDiffSignal,
} from "./types";

const DEFAULT_MAX_DIFFS = 8;

function sortedEntries(entries: TraceEntry[]): TraceEntry[] {
  return [...entries].sort((a, b) => (a.turnNumber ?? 0) - (b.turnNumber ?? 0));
}

function byTurn(entries: TraceEntry[]): Map<number, TraceEntry> {
  const map = new Map<number, TraceEntry>();
  for (const entry of sortedEntries(entries)) {
    map.set(entry.turnNumber, entry);
  }
  return map;
}

function maxTurn(entries: TraceEntry[]): number {
  return entries.reduce(
    (max, entry) => Math.max(max, entry.turnNumber || 0),
    0,
  );
}

function listEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function join(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function pageKey(entry: TraceEntry): string {
  const url = entry.snapshot?.url ?? "";
  if (!url) return "-";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function toolCalls(entry: TraceEntry): string[] {
  return (entry.llmResponse?.toolCalls ?? []).map(
    (call) => call.function?.name || "unknown",
  );
}

function toolResults(entry: TraceEntry): string[] {
  return (entry.toolExecutions ?? []).map(
    (execution) =>
      `${execution.toolName}:${execution.success ? "ok" : "failed"}`,
  );
}

function failedTools(entry: TraceEntry): string[] {
  return (entry.toolExecutions ?? [])
    .filter((execution) => !execution.success)
    .map((execution) => execution.toolName);
}

function eventTypes(entry: TraceEntry): string[] {
  return (entry.events ?? [])
    .map((event) => event.type)
    .filter((type) => type !== "screenshot");
}

function modelState(entry: TraceEntry): string {
  return [
    entry.llmRequest?.model || "-",
    entry.llmResponse?.actualProviderId
      ? `via ${entry.llmResponse.actualProviderId}`
      : "",
    entry.llmResponse?.actualModel
      ? `actual ${entry.llmResponse.actualModel}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function finishState(entry: TraceEntry): string {
  return entry.llmResponse?.finishReason || "-";
}

function perceptionState(entry: TraceEntry): string {
  const perception = entry.perception;
  if (!perception) return "missing";
  return [
    perception.mode || "unknown-mode",
    perception.source || "unknown-source",
    perception.screenshotStatus || "unknown-shot",
    perception.fallbackReason ? `fallback:${perception.fallbackReason}` : "",
    perception.cached ? "cached" : "fresh",
  ]
    .filter(Boolean)
    .join(" ");
}

function isDegradedPerception(entry: TraceEntry): boolean {
  const perception = entry.perception;
  if (!perception) return true;
  return (
    perception.source === "fallback" ||
    perception.screenshotStatus === "missing" ||
    perception.screenshotStatus === "capture_failed" ||
    Boolean(perception.fallbackReason)
  );
}

function contextState(entry: TraceEntry): string {
  const context = entry.llmRequest?.contextMetrics;
  const compression = entry.llmRequest?.compressionLevel || "none";
  if (!context) return `compression=${compression}`;
  return `compression=${compression} utilization=${Math.round(
    (context.utilization || 0) * 100,
  )}% dropped=${context.droppedMessageCount || 0}`;
}

function contextHot(entry: TraceEntry): boolean {
  return (entry.llmRequest?.contextMetrics?.utilization ?? 0) >= 0.85;
}

function progressState(entry: TraceEntry): string {
  const progress = entry.progressState;
  if (!progress) return "-";
  return `${progress.signal || "none"}:${progress.stagnantTurns || 0}`;
}

function severityRank(severity: InvestigationSeverity): number {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function worstSeverity(signals: TraceTurnDiffSignal[]): InvestigationSeverity {
  return signals.reduce<InvestigationSeverity>(
    (worst, signal) =>
      severityRank(signal.severity) > severityRank(worst)
        ? signal.severity
        : worst,
    "info",
  );
}

function pushSignal(
  signals: TraceTurnDiffSignal[],
  turnNumber: number,
  category: TraceTimelineDiffCategory,
  severity: InvestigationSeverity,
  label: string,
  base: string | undefined,
  candidate: string | undefined,
  changed = true,
) {
  signals.push({
    id: `${turnNumber}-${category}-${signals.length}`,
    category,
    severity,
    label,
    ...(base != null ? { base } : {}),
    ...(candidate != null ? { candidate } : {}),
    changed,
  });
}

function compareTurn(
  turnNumber: number,
  base: TraceEntry | undefined,
  candidate: TraceEntry | undefined,
  includeSharedFailures: boolean,
): TraceTurnDiff | null {
  const signals: TraceTurnDiffSignal[] = [];

  if (!base || !candidate) {
    pushSignal(
      signals,
      turnNumber,
      "missing_turn",
      "warning",
      base
        ? "Candidate stopped before this turn"
        : "Base stopped before this turn",
      base ? "present" : "missing",
      candidate ? "present" : "missing",
    );
  } else {
    const basePage = pageKey(base);
    const candidatePage = pageKey(candidate);
    if (basePage !== candidatePage) {
      pushSignal(
        signals,
        turnNumber,
        "page",
        "warning",
        "Page state diverged",
        basePage,
        candidatePage,
      );
    }

    const baseModel = modelState(base);
    const candidateModel = modelState(candidate);
    if (baseModel !== candidateModel) {
      pushSignal(
        signals,
        turnNumber,
        "model_provider",
        "info",
        "Model/provider changed",
        baseModel,
        candidateModel,
      );
    }

    const baseFinish = finishState(base);
    const candidateFinish = finishState(candidate);
    if (baseFinish !== candidateFinish) {
      pushSignal(
        signals,
        turnNumber,
        "completion",
        "warning",
        "LLM finish reason changed",
        baseFinish,
        candidateFinish,
      );
    }

    const baseCalls = toolCalls(base);
    const candidateCalls = toolCalls(candidate);
    if (!listEqual(baseCalls, candidateCalls)) {
      pushSignal(
        signals,
        turnNumber,
        "tool_execution",
        "warning",
        "Tool choice changed",
        join(baseCalls),
        join(candidateCalls),
      );
    }

    const baseResults = toolResults(base);
    const candidateResults = toolResults(candidate);
    if (!listEqual(baseResults, candidateResults)) {
      pushSignal(
        signals,
        turnNumber,
        "tool_execution",
        baseResults
          .concat(candidateResults)
          .some((result) => result.endsWith(":failed"))
          ? "error"
          : "warning",
        "Tool result changed",
        join(baseResults),
        join(candidateResults),
      );
    } else if (includeSharedFailures) {
      const baseFailures = failedTools(base);
      const candidateFailures = failedTools(candidate);
      if (
        baseFailures.length > 0 &&
        candidateFailures.length > 0 &&
        listEqual(baseFailures, candidateFailures)
      ) {
        pushSignal(
          signals,
          turnNumber,
          "tool_execution",
          "error",
          "Shared tool failure",
          join(baseFailures),
          join(candidateFailures),
          false,
        );
      }
    }

    const baseEvents = eventTypes(base);
    const candidateEvents = eventTypes(candidate);
    if (!listEqual(baseEvents, candidateEvents)) {
      const verificationEvents = new Set([
        "done_rejected",
        "verifier_rejected",
      ]);
      const category = [...baseEvents, ...candidateEvents].some((event) =>
        verificationEvents.has(event),
      )
        ? "verification"
        : "loop";
      pushSignal(
        signals,
        turnNumber,
        category,
        "warning",
        "Runtime events changed",
        join(baseEvents),
        join(candidateEvents),
      );
    }

    const basePerception = perceptionState(base);
    const candidatePerception = perceptionState(candidate);
    if (basePerception !== candidatePerception) {
      pushSignal(
        signals,
        turnNumber,
        "perception",
        isDegradedPerception(base) || isDegradedPerception(candidate)
          ? "warning"
          : "info",
        "Perception mode changed",
        basePerception,
        candidatePerception,
      );
    }

    const baseContext = contextState(base);
    const candidateContext = contextState(candidate);
    if (
      baseContext !== candidateContext &&
      (contextHot(base) || contextHot(candidate))
    ) {
      pushSignal(
        signals,
        turnNumber,
        "context",
        "warning",
        "Context pressure changed",
        baseContext,
        candidateContext,
      );
    }

    const baseProgress = progressState(base);
    const candidateProgress = progressState(candidate);
    if (baseProgress !== candidateProgress) {
      pushSignal(
        signals,
        turnNumber,
        "loop",
        "info",
        "Progress monitor changed",
        baseProgress,
        candidateProgress,
      );
    }
  }

  if (signals.length === 0) return null;

  const changedSignals = signals.filter((signal) => signal.changed);
  const firstSignal = changedSignals[0] ?? signals[0];
  const severity = worstSeverity(signals);
  return {
    turnNumber,
    severity,
    summary: firstSignal.label,
    ...(base?.snapshot?.url ? { baseUrl: base.snapshot.url } : {}),
    ...(base?.snapshot?.title ? { baseTitle: base.snapshot.title } : {}),
    ...(candidate?.snapshot?.url
      ? { candidateUrl: candidate.snapshot.url }
      : {}),
    ...(candidate?.snapshot?.title
      ? { candidateTitle: candidate.snapshot.title }
      : {}),
    signals,
  };
}

function recommendedAction(first: TraceTurnDiff | undefined): string {
  const signal =
    first?.signals.find((item) => item.changed) ?? first?.signals[0];
  switch (signal?.category) {
    case "tool_execution":
      return "Inspect tool arguments and post-tool page state at the first changed turn.";
    case "page":
      return "Compare navigation and page state before the first changed decision.";
    case "perception":
      return "Compare screenshots and perception fallback reasons before judging the model decision.";
    case "context":
      return "Inspect compressed context and dropped history before the changed decision.";
    case "model_provider":
      return "Check provider/model failover and whether the candidate used a different model path.";
    case "verification":
      return "Compare done/verifier evidence around the changed turn.";
    case "missing_turn":
      return "Inspect the prior turn to understand why one session stopped earlier.";
    default:
      return "Start at the first highlighted turn and compare tool choice, page state, and evidence.";
  }
}

export function compareTraceTimelines(
  input: TraceTimelineDiffInput,
  options: TraceTimelineDiffOptions = {},
): TraceTimelineDiff {
  const maxDiffs = options.maxDiffs ?? DEFAULT_MAX_DIFFS;
  const includeSharedFailures = options.includeSharedFailures ?? true;
  const baseByTurn = byTurn(input.baseEntries);
  const candidateByTurn = byTurn(input.candidateEntries);
  const turnsCompared = Math.max(
    maxTurn(input.baseEntries),
    maxTurn(input.candidateEntries),
  );
  const diffs: TraceTurnDiff[] = [];

  for (let turnNumber = 1; turnNumber <= turnsCompared; turnNumber++) {
    const diff = compareTurn(
      turnNumber,
      baseByTurn.get(turnNumber),
      candidateByTurn.get(turnNumber),
      includeSharedFailures,
    );
    if (diff) diffs.push(diff);
  }

  const firstDivergence =
    diffs.find((diff) => diff.signals.some((signal) => signal.changed)) ?? null;
  const firstSignal = firstDivergence?.signals.find((signal) => signal.changed);
  const visibleDiffs = diffs.slice(0, maxDiffs);
  const headline = firstDivergence
    ? `First divergence at T${firstDivergence.turnNumber}: ${firstSignal?.label ?? firstDivergence.summary}`
    : diffs.length > 0
      ? `No divergence found; shared high-signal behavior starts at T${diffs[0].turnNumber}.`
      : `No turn-level divergence detected across ${turnsCompared} turns.`;

  return {
    baseSessionId: input.baseSession.sessionId,
    candidateSessionId: input.candidateSession.sessionId,
    turnsCompared,
    firstDivergenceTurn: firstDivergence?.turnNumber ?? null,
    headline,
    recommendedAction: recommendedAction(firstDivergence ?? visibleDiffs[0]),
    diffs: visibleDiffs,
  };
}
