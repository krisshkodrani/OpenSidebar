import type {
  TraceEntry,
  TracePerceptionFallbackReason,
  TracePerceptionFreshnessReason,
  TracePerceptionScreenshotStatus,
  TracePerceptionSource,
  TraceSession,
} from "../types/traces";

type CounterMap<T extends string> = Partial<Record<T, number>>;

export type EscalationOutcomeCounts = {
  rescued: number;
  failedFast: number;
  budgetExhausted: number;
};

export interface SessionDiagnostics {
  productiveTurns: number;
  wastedTurns: number;
  loopTurns: number;
  escalations: number;
  escalationOutcomes: EscalationOutcomeCounts;
  failovers: number;
  perceptionCalls: number;
  perceptionCacheHits: number;
  structuredPerceptionTurns: number;
  vlScreenshotTurns: number;
  elementOnlyTurns: number;
  degradedPerceptionTurns: number;
  contextHotTurns: number;
  toolFailureTurns: number;
  perceptionSources: CounterMap<TracePerceptionSource>;
  perceptionFreshness: CounterMap<TracePerceptionFreshnessReason>;
  perceptionFallbacks: CounterMap<TracePerceptionFallbackReason>;
  perceptionScreenshots: CounterMap<TracePerceptionScreenshotStatus>;
}

function getToolNames(entry: TraceEntry): string[] {
  return entry.toolExecutions.map((tool) => tool.toolName);
}

function hasSameToolSequence(
  a: TraceEntry | undefined,
  b: TraceEntry,
): boolean {
  if (!a) return false;
  const prev = getToolNames(a);
  const next = getToolNames(b);
  return prev.length > 0 && prev.join("|") === next.join("|");
}

function hasSameSnapshot(a: TraceEntry | undefined, b: TraceEntry): boolean {
  if (!a) return false;
  return (
    a.snapshot.url === b.snapshot.url && a.snapshot.title === b.snapshot.title
  );
}

function hasSuccessfulTool(entry: TraceEntry): boolean {
  return entry.toolExecutions.some((tool) => tool.success);
}

function hasAssistantContent(entry: TraceEntry): boolean {
  return Boolean(
    entry.llmResponse?.content && entry.llmResponse.content.trim().length > 0,
  );
}

function incrementCounter<T extends string>(
  counts: CounterMap<T>,
  key: T | undefined,
): void {
  if (!key) return;
  counts[key] = (counts[key] ?? 0) + 1;
}

export function computeSessionDiagnostics(
  _session: TraceSession,
  entries: TraceEntry[],
): SessionDiagnostics {
  let productiveTurns = 0;
  let loopTurns = 0;
  let escalations = 0;
  const escalationOutcomes: EscalationOutcomeCounts = {
    rescued: 0,
    failedFast: 0,
    budgetExhausted: 0,
  };
  let failovers = 0;
  let perceptionCalls = 0;
  let perceptionCacheHits = 0;
  let structuredPerceptionTurns = 0;
  let vlScreenshotTurns = 0;
  let elementOnlyTurns = 0;
  let degradedPerceptionTurns = 0;
  let contextHotTurns = 0;
  let toolFailureTurns = 0;
  const perceptionSources: CounterMap<TracePerceptionSource> = {};
  const perceptionFreshness: CounterMap<TracePerceptionFreshnessReason> = {};
  const perceptionFallbacks: CounterMap<TracePerceptionFallbackReason> = {};
  const perceptionScreenshots: CounterMap<TracePerceptionScreenshotStatus> = {};

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const previous = entries[i - 1];
    const toolExecutions = entry.toolExecutions || [];
    const allToolsFailed =
      toolExecutions.length > 0 &&
      toolExecutions.every((tool) => !tool.success);
    const repeatedToolLoop =
      hasSameToolSequence(previous, entry) && hasSameSnapshot(previous, entry);
    const productive =
      hasSuccessfulTool(entry) ||
      (hasAssistantContent(entry) &&
        (entry.llmResponse?.toolCalls?.length ?? 0) === 0 &&
        toolExecutions.length === 0);

    if (productive) productiveTurns++;
    if (allToolsFailed || repeatedToolLoop) loopTurns++;
    if (allToolsFailed) toolFailureTurns++;
    if (entry.perception) {
      perceptionCalls++;
      if (entry.perception.cached) perceptionCacheHits++;
      incrementCounter(perceptionSources, entry.perception.source);
      incrementCounter(perceptionFreshness, entry.perception.freshnessReason);
      incrementCounter(perceptionFallbacks, entry.perception.fallbackReason);
      incrementCounter(
        perceptionScreenshots,
        entry.perception.screenshotStatus,
      );
      switch (entry.perception.mode) {
        case "structured":
          structuredPerceptionTurns++;
          break;
        case "vl_screenshot_only":
          vlScreenshotTurns++;
          break;
        case "element_only":
          elementOnlyTurns++;
          break;
      }
      if (
        entry.perception.mode === "element_only" ||
        entry.perception.source === "fallback" ||
        Boolean(entry.perception.fallbackReason)
      ) {
        degradedPerceptionTurns++;
      }
    }
    if (
      (entry.llmRequest?.contextMetrics?.utilization ?? 0) >= 0.85 ||
      (entry.llmRequest?.contextMetrics?.droppedMessageCount ?? 0) > 0
    ) {
      contextHotTurns++;
    }
    if (
      entry.llmResponse?.actualModel &&
      entry.llmResponse.actualModel !== entry.llmRequest?.model
    ) {
      failovers++;
    }

    // Prefer the canonical escalation_triggered stream (RFC LP-2) when an
    // entry has it; legacy escalation/stuck_signal events overlap with it
    // (voluntary escalate emits both) and would double count.
    const entryEvents = entry.events || [];
    const canonicalEscalations = entryEvents.filter(
      (event) => event.type === "escalation_triggered",
    ).length;
    if (canonicalEscalations > 0) {
      escalations += canonicalEscalations;
    } else {
      for (const event of entryEvents) {
        if (event.type === "escalation") {
          escalations++;
        } else if (
          event.type === "stuck_signal" &&
          (event.data as { type?: string } | undefined)?.type === "escalate"
        ) {
          escalations++;
        }
      }
    }
    for (const event of entryEvents) {
      if (event.type !== "escalation_outcome") continue;
      const outcome = (event.data as { outcome?: string } | undefined)
        ?.outcome;
      if (outcome === "rescued") escalationOutcomes.rescued++;
      else if (outcome === "failed_fast") escalationOutcomes.failedFast++;
      else if (outcome === "budget_exhausted")
        escalationOutcomes.budgetExhausted++;
    }
  }

  return {
    productiveTurns,
    wastedTurns: Math.max(0, entries.length - productiveTurns),
    loopTurns,
    escalations,
    escalationOutcomes,
    failovers,
    perceptionCalls,
    perceptionCacheHits,
    structuredPerceptionTurns,
    vlScreenshotTurns,
    elementOnlyTurns,
    degradedPerceptionTurns,
    contextHotTurns,
    toolFailureTurns,
    perceptionSources,
    perceptionFreshness,
    perceptionFallbacks,
    perceptionScreenshots,
  };
}
