import type { TraceEntry, TraceEvent } from "../../types/traces";
import type {
  TraceAnalysisInput,
  TraceInvestigation,
  InvestigationFinding,
} from "./types";

function toolNames(entry: TraceEntry): string[] {
  return (entry.toolExecutions ?? []).map((tool) => String(tool.toolName));
}

function sameSnapshot(a: TraceEntry | undefined, b: TraceEntry): boolean {
  if (!a) return false;
  return (
    a.snapshot?.url === b.snapshot?.url &&
    a.snapshot?.title === b.snapshot?.title
  );
}

function sameToolSequence(a: TraceEntry | undefined, b: TraceEntry): boolean {
  if (!a) return false;
  const prev = toolNames(a);
  const next = toolNames(b);
  return prev.length > 0 && prev.join("|") === next.join("|");
}

function countEvents(entries: TraceEntry[], type: string): number {
  return entries.reduce(
    (count, entry) =>
      count +
      (entry.events ?? []).filter((event) => event.type === type).length,
    0,
  );
}

function findEvents(
  entries: TraceEntry[],
  type: string,
): Array<{ entry: TraceEntry; event: TraceEvent }> {
  const matches: Array<{ entry: TraceEntry; event: TraceEvent }> = [];
  for (const entry of entries) {
    for (const event of entry.events ?? []) {
      if (event.type === type) matches.push({ entry, event });
    }
  }
  return matches;
}

function eventDataString(event: TraceEvent, key: string): string | null {
  const value = (event.data as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function addFinding(
  findings: InvestigationFinding[],
  finding: InvestigationFinding,
): void {
  findings.push(finding);
}

function sortFindings(
  findings: InvestigationFinding[],
): InvestigationFinding[] {
  const severityRank = { error: 0, warning: 1, info: 2 };
  return [...findings].sort((a, b) => {
    const severity = severityRank[a.severity] - severityRank[b.severity];
    if (severity !== 0) return severity;
    return (a.firstTurn ?? Infinity) - (b.firstTurn ?? Infinity);
  });
}

function firstFindingTurn(findings: InvestigationFinding[]): number | null {
  const turns = findings
    .filter((finding) => finding.severity !== "info")
    .map((finding) => finding.firstTurn)
    .filter((turn): turn is number => typeof turn === "number");
  return turns.length > 0 ? Math.min(...turns) : null;
}

function isProductive(entry: TraceEntry): boolean {
  if ((entry.toolExecutions ?? []).some((tool) => tool.success)) return true;
  return Boolean(
    entry.llmResponse?.content &&
    entry.llmResponse.content.trim().length > 0 &&
    (entry.llmResponse?.toolCalls?.length ?? 0) === 0 &&
    (entry.toolExecutions?.length ?? 0) === 0,
  );
}

function categoryAction(
  category: TraceInvestigation["likelyFailureClass"],
): string {
  switch (category) {
    case "tool_execution":
      return "Reproduce the failed tool call with its target and fix tool behavior or recovery.";
    case "loop":
      return "Inspect the first repeated action and strengthen loop detection or planner recovery.";
    case "completion":
      return "Compare done summaries with plan state and verifier evidence.";
    case "planning":
      return "Inspect plan monitor and replan events before changing prompts or skills.";
    case "perception":
      return "Compare screenshot, element summary, and page interpretation at the first degraded turn.";
    case "context":
      return "Inspect context pressure and compression around the hot turn.";
    case "model_provider":
      return "Check provider failover, served model, and latency before judging runtime behavior.";
    case "verification":
      return "Inspect verifier decisions and evidence requirements for the rejected turn.";
    case "budget":
      return "Inspect late-session loops and budget gates before increasing turn limits.";
    default:
      return "Inspect the timeline and raw turns for evidence.";
  }
}

export function analyzeTraceSession(
  input: TraceAnalysisInput,
): TraceInvestigation {
  const { session, entries, runEvents = [], logs = [] } = input;
  const findings: InvestigationFinding[] = [];
  const sessionId = session.sessionId;

  for (const entry of entries) {
    const failedTool = (entry.toolExecutions ?? []).find(
      (tool) => !tool.success,
    );
    if (failedTool) {
      addFinding(findings, {
        id: `tool-failure-t${entry.turnNumber}`,
        category: "tool_execution",
        severity: "error",
        title: `Tool failed: ${failedTool.toolName}`,
        summary:
          failedTool.error ||
          failedTool.result ||
          "A tool execution returned an unsuccessful result.",
        confidence: 0.95,
        firstTurn: entry.turnNumber,
        evidence: [
          {
            kind: "tool",
            sessionId,
            turnNumber: entry.turnNumber,
            toolCallId: failedTool.toolCallId,
            label: `${failedTool.toolName} failed on turn ${entry.turnNumber}`,
          },
        ],
      });
      break;
    }
  }

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    const previous = entries[i - 1];
    if (sameToolSequence(previous, entry) && sameSnapshot(previous, entry)) {
      addFinding(findings, {
        id: `repeat-loop-t${entry.turnNumber}`,
        category: "loop",
        severity: "warning",
        title: "Repeated action loop",
        summary: `Turns ${previous.turnNumber} and ${entry.turnNumber} used the same tool sequence without a page-state change.`,
        confidence: 0.8,
        firstTurn: entry.turnNumber,
        evidence: [
          {
            kind: "turn",
            sessionId,
            turnNumber: previous.turnNumber,
            label: `Previous repeated turn ${previous.turnNumber}`,
          },
          {
            kind: "turn",
            sessionId,
            turnNumber: entry.turnNumber,
            label: `Repeated turn ${entry.turnNumber}`,
          },
        ],
      });
      break;
    }
  }

  const doneRejections = findEvents(entries, "done_rejected");
  if (doneRejections.length > 0) {
    const first = doneRejections[0];
    addFinding(findings, {
      id: "done-rejection-loop",
      category: "completion",
      severity: doneRejections.length >= 3 ? "error" : "warning",
      title: "Completion rejected by runtime gate",
      summary:
        eventDataString(first.event, "reason") ||
        `The runtime rejected done ${doneRejections.length} time(s).`,
      confidence: 0.9,
      firstTurn: first.entry.turnNumber,
      evidence: doneRejections.slice(0, 3).map(({ entry, event }) => ({
        kind: "event",
        sessionId,
        turnNumber: entry.turnNumber,
        eventType: event.type,
        label: `done_rejected on turn ${entry.turnNumber}`,
      })),
    });
  }

  const stale = entries.find(
    (entry) =>
      (entry.progressState?.stagnantTurns ?? 0) >= 3 ||
      Boolean(entry.progressState?.signal),
  );
  if (stale) {
    addFinding(findings, {
      id: `stale-progress-t${stale.turnNumber}`,
      category: "loop",
      severity: "warning",
      title: "Stale progress detected",
      summary: `Progress tracker reported ${stale.progressState?.stagnantTurns ?? 0} stagnant turns${stale.progressState?.signal ? ` (${stale.progressState.signal})` : ""}.`,
      confidence: 0.75,
      firstTurn: stale.turnNumber,
      evidence: [
        {
          kind: "turn",
          sessionId,
          turnNumber: stale.turnNumber,
          label: `Progress state on turn ${stale.turnNumber}`,
        },
      ],
    });
  }

  const planDrift = entries.flatMap((entry) =>
    (entry.events ?? [])
      .filter(
        (event) =>
          event.type === "plan_monitor" &&
          ["deviated", "blocked"].includes(
            String((event.data as Record<string, unknown>).alignment ?? ""),
          ),
      )
      .map((event) => ({ entry, event })),
  );
  if (planDrift.length > 0) {
    const first = planDrift[0];
    addFinding(findings, {
      id: `plan-drift-t${first.entry.turnNumber}`,
      category: "planning",
      severity: "warning",
      title: "Plan drift or blocker",
      summary:
        eventDataString(first.event, "reason") ||
        "The plan monitor marked the active step as deviated or blocked.",
      confidence: 0.85,
      firstTurn: first.entry.turnNumber,
      evidence: [
        {
          kind: "event",
          sessionId,
          turnNumber: first.entry.turnNumber,
          eventType: first.event.type,
          label: `plan_monitor on turn ${first.entry.turnNumber}`,
        },
      ],
    });
  }

  const replanCount = countEvents(entries, "plan_replan");
  if (replanCount > 0) {
    const first = findEvents(entries, "plan_replan")[0];
    addFinding(findings, {
      id: "replan-activity",
      category: "planning",
      severity: replanCount >= 3 ? "warning" : "info",
      title: replanCount >= 3 ? "Repeated replanning" : "Replan occurred",
      summary: `The agent replanned ${replanCount} time(s).`,
      confidence: 0.8,
      firstTurn: first?.entry.turnNumber,
      evidence: [
        {
          kind: "event",
          sessionId,
          turnNumber: first?.entry.turnNumber,
          eventType: "plan_replan",
          label: "First plan_replan event",
        },
      ],
    });
  }

  const degradedPerception = entries.find(
    (entry) =>
      entry.perception &&
      (entry.perception.mode === "element_only" ||
        entry.perception.source === "fallback" ||
        Boolean(entry.perception.fallbackReason) ||
        entry.perception.screenshotStatus === "capture_failed" ||
        entry.perception.screenshotStatus === "missing"),
  );
  if (degradedPerception?.perception) {
    addFinding(findings, {
      id: `degraded-perception-t${degradedPerception.turnNumber}`,
      category: "perception",
      severity: "warning",
      title: "Degraded perception",
      summary:
        degradedPerception.perception.fallbackReason ||
        degradedPerception.perception.screenshotStatus ||
        degradedPerception.perception.mode ||
        "Perception fell back to a degraded mode.",
      confidence: 0.85,
      firstTurn: degradedPerception.turnNumber,
      evidence: [
        {
          kind: "perception",
          sessionId,
          turnNumber: degradedPerception.turnNumber,
          label: `Perception on turn ${degradedPerception.turnNumber}`,
        },
      ],
    });
  }

  const contextHot = entries.find(
    (entry) =>
      (entry.llmRequest?.contextMetrics?.utilization ?? 0) >= 0.85 ||
      (entry.llmRequest?.contextMetrics?.droppedMessageCount ?? 0) > 0,
  );
  if (contextHot) {
    addFinding(findings, {
      id: `context-pressure-t${contextHot.turnNumber}`,
      category: "context",
      severity: "warning",
      title: "Context pressure",
      summary: `Context utilization reached ${Math.round((contextHot.llmRequest.contextMetrics?.utilization ?? 0) * 100)}% with ${contextHot.llmRequest.contextMetrics?.droppedMessageCount ?? 0} dropped messages.`,
      confidence: 0.9,
      firstTurn: contextHot.turnNumber,
      evidence: [
        {
          kind: "turn",
          sessionId,
          turnNumber: contextHot.turnNumber,
          label: `Context metrics on turn ${contextHot.turnNumber}`,
        },
      ],
    });
  }

  const failover = entries.find(
    (entry) =>
      entry.llmResponse?.actualModel &&
      entry.llmResponse.actualModel !== entry.llmRequest?.model,
  );
  if (failover) {
    addFinding(findings, {
      id: `model-failover-t${failover.turnNumber}`,
      category: "model_provider",
      severity: "info",
      title: "Model/provider failover",
      summary: `Requested ${failover.llmRequest.model}, served ${failover.llmResponse.actualModel}.`,
      confidence: 0.95,
      firstTurn: failover.turnNumber,
      evidence: [
        {
          kind: "turn",
          sessionId,
          turnNumber: failover.turnNumber,
          label: `LLM response metadata on turn ${failover.turnNumber}`,
        },
      ],
    });
  }

  const errorLogIndex = logs.findIndex((log) =>
    ["error", "fatal"].includes(String(log.lvl).toLowerCase()),
  );
  if (errorLogIndex >= 0) {
    const log = logs[errorLogIndex];
    addFinding(findings, {
      id: "runtime-error-log",
      category: "trace_integrity",
      severity: session.outcome === "completed" ? "warning" : "error",
      title: "Runtime error logged",
      summary: log.msg || "A session-scoped runtime error was logged.",
      confidence: 0.7,
      evidence: [
        {
          kind: "log",
          sessionId,
          logIndex: errorLogIndex,
          label: `${log.src || "runtime"}:${log.cat || "log"}`,
        },
      ],
    });
  }

  const verifierReject = runEvents.find((event) => {
    const text =
      `${event.type} ${JSON.stringify(event.data ?? {})}`.toLowerCase();
    return (
      text.includes("verifier") &&
      (text.includes("reject") || text.includes("fail"))
    );
  });
  if (verifierReject) {
    addFinding(findings, {
      id: "verifier-rejection",
      category: "verification",
      severity: "warning",
      title: "Verifier rejected progress",
      summary: String(verifierReject.data?.reason ?? verifierReject.type),
      confidence: 0.75,
      firstTurn: verifierReject.turn,
      evidence: [
        {
          kind: "run_event",
          runId: verifierReject.runId,
          turnNumber: verifierReject.turn,
          eventType: verifierReject.type,
          label: `Run event ${verifierReject.type}`,
        },
      ],
    });
  }

  if (session.outcome === "max_turns") {
    addFinding(findings, {
      id: "max-turns",
      category: "budget",
      severity: "error",
      title: "Run exhausted turn budget",
      summary:
        session.failureDetail ||
        "The session ended because it reached the maximum turn budget.",
      confidence: 0.95,
      firstTurn: entries.at(-1)?.turnNumber,
      evidence: [
        {
          kind: "session",
          sessionId,
          label: "Session outcome is max_turns",
        },
      ],
    });
  }

  const orderedFindings = sortFindings(findings);
  const firstBadTurn = firstFindingTurn(orderedFindings);
  const likelyFailureClass =
    orderedFindings.find((finding) => finding.severity !== "info")?.category ??
    (session.outcome === "completed" ? "none" : "trace_integrity");

  const productiveTurns = entries.filter(isProductive).length;
  const toolFailureTurns = entries.filter((entry) =>
    (entry.toolExecutions ?? []).some((tool) => !tool.success),
  ).length;
  const perceptionTurns = entries.filter((entry) => entry.perception).length;
  const degradedPerceptionTurns = entries.filter(
    (entry) =>
      entry.perception &&
      (entry.perception.mode === "element_only" ||
        entry.perception.source === "fallback" ||
        Boolean(entry.perception.fallbackReason)),
  ).length;
  const contextHotTurns = entries.filter(
    (entry) =>
      (entry.llmRequest?.contextMetrics?.utilization ?? 0) >= 0.85 ||
      (entry.llmRequest?.contextMetrics?.droppedMessageCount ?? 0) > 0,
  ).length;

  const headline =
    orderedFindings[0]?.title ??
    (session.outcome === "completed"
      ? "No high-signal issues detected"
      : "No structured diagnosis available");

  return {
    sessionId,
    outcome: session.outcome,
    likelyFailureClass,
    firstBadTurn,
    headline,
    recommendedAction: categoryAction(likelyFailureClass),
    metrics: {
      turnCount: entries.length || session.turnCount || 0,
      productiveTurns,
      toolFailureTurns,
      perceptionTurns,
      degradedPerceptionTurns,
      contextHotTurns,
      replanCount,
      doneRejectionCount: doneRejections.length,
      totalCost: session.metrics?.totalCost ?? 0,
      totalTokens: session.metrics?.totalTokens ?? 0,
    },
    findings: orderedFindings,
  };
}
