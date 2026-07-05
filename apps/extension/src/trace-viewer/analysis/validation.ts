import type {
  FrozenTraceBundle,
  TraceBundleValidationInput,
  TraceValidationIssue,
  TraceValidationResult,
} from "./types";
import type { RunTraceEvent } from "../../utils/run-trace";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function push(
  issues: TraceValidationIssue[],
  severity: TraceValidationIssue["severity"],
  code: string,
  message: string,
  context: Partial<TraceValidationIssue> = {},
): void {
  issues.push({ severity, code, message, ...context });
}

function dataRecord(event: RunTraceEvent): Record<string, unknown> {
  return isRecord(event.data) ? event.data : {};
}

function arrayValue(
  record: Record<string, unknown>,
  key: string,
): unknown[] | null {
  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function workerKey(event: RunTraceEvent): string | null {
  const data = dataRecord(event);
  return (
    stringValue(data, "workerId") ??
    (stringValue(data, "nodeId")
      ? `node:${stringValue(data, "nodeId")}`
      : null)
  );
}

function extractGraphDependencies(
  event: RunTraceEvent,
): Map<string, string[]> {
  const dependencies = new Map<string, string[]>();
  const graph = dataRecord(event).graph;
  if (!isRecord(graph)) return dependencies;
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return dependencies;

  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const nodeId = stringValue(node, "nodeId");
    if (!nodeId) continue;
    dependencies.set(
      nodeId,
      (arrayValue(node, "dependencies") ?? []).filter(
        (dependency): dependency is string =>
          typeof dependency === "string" && dependency.length > 0,
      ),
    );
  }

  return dependencies;
}

function runEventTimestamp(event: RunTraceEvent, index: number): number {
  const parsed = Date.parse(event.ts);
  return Number.isFinite(parsed) ? parsed : index;
}

function validateParallelRunEvents(
  runId: string,
  events: RunTraceEvent[],
  issues: TraceValidationIssue[],
): void {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        runEventTimestamp(a.event, a.index) -
          runEventTimestamp(b.event, b.index) || a.index - b.index,
    );
  const activeWorkers = new Map<
    string,
    { nodeId: string | null; resources: unknown[]; eventIndex: number }
  >();
  const knownWorkers = new Set<string>();
  const finishedWorkers = new Set<string>();
  const completedNodes = new Set<string>();
  const graphDependencies = new Map<string, string[]>();
  const workerStateEventTypes = new Set([
    "worker_queued",
    "worker_started",
    "worker_blocked_resource",
    "worker_released_resource",
    "worker_cancelled",
  ]);

  for (const { event, index } of ordered) {
    const data = dataRecord(event);
    if (event.type === "plan_decomposed") {
      for (const [nodeId, dependencies] of extractGraphDependencies(event)) {
        graphDependencies.set(nodeId, dependencies);
      }
    }

    if (workerStateEventTypes.has(event.type)) {
      if (numberValue(data, "activeWorkerCount") == null) {
        push(
          issues,
          "warning",
          "missing_parallel_active_worker_count",
          `${event.type} is missing activeWorkerCount`,
          { runId },
        );
      }
      if (!arrayValue(data, "resourceLocks")) {
        push(
          issues,
          "warning",
          "missing_parallel_resource_locks",
          `${event.type} is missing resourceLocks`,
          { runId },
        );
      }
    }

    if (event.type === "node_completed") {
      const nodeId = stringValue(data, "nodeId");
      const outcome = stringValue(data, "outcome");
      if (nodeId && (outcome === "completed" || outcome === "skipped")) {
        completedNodes.add(nodeId);
      }
    }

    if (event.type === "worker_started") {
      const key = workerKey(event);
      const nodeId = stringValue(data, "nodeId");
      if (nodeId) {
        const missingDependencies = (graphDependencies.get(nodeId) ?? []).filter(
          (dependency) => !completedNodes.has(dependency),
        );
        if (missingDependencies.length > 0) {
          push(
            issues,
            "error",
            "dependency_started_before_complete",
            `Worker for ${nodeId} started before dependencies completed: ${missingDependencies.join(", ")}`,
            { runId },
          );
        }
      }
      if (key) {
        knownWorkers.add(key);
        activeWorkers.set(key, {
          nodeId,
          resources: arrayValue(data, "assignedResources") ?? [],
          eventIndex: index,
        });
      }
    }

    if (
      event.type === "worker_released_resource" ||
      event.type === "worker_cancelled"
    ) {
      const key = workerKey(event);
      if (!key) continue;
      if (finishedWorkers.has(key)) continue;
      if (!knownWorkers.has(key)) {
        push(
          issues,
          "warning",
          "worker_finish_without_start",
          `${event.type} was recorded before worker_started for ${key}`,
          { runId },
        );
      }
      finishedWorkers.add(key);
      activeWorkers.delete(key);
    }
  }

  for (const [key, active] of activeWorkers) {
    push(
      issues,
      "error",
      "missing_worker_finish",
      `Worker ${key} started but no release or cancellation event was recorded`,
      { runId },
    );
    if (active.resources.length > 0) {
      push(
        issues,
        "error",
        "orphan_resource_lock",
        `Worker ${key} left ${active.resources.length} resource lock(s) without release`,
        { runId },
      );
    }
  }
}

function detectKind(record: Record<string, unknown>): string {
  const kind = stringValue(record, "traceKind");
  if (kind) return kind;
  if (isRecord(record.snapshot) && numberValue(record, "turnNumber") != null) {
    return "agent.turn";
  }
  if (stringValue(record, "outcome") && stringValue(record, "sessionId")) {
    return "agent.session";
  }
  if (stringValue(record, "type") && stringValue(record, "runId")) {
    return "orchestrator.run.event";
  }
  if (stringValue(record, "startedAt") && stringValue(record, "runId")) {
    return "orchestrator.run.manifest";
  }
  return "unknown";
}

export function validateTraceRecord(
  record: unknown,
  context: Partial<TraceValidationIssue> = {},
): TraceValidationResult {
  const issues: TraceValidationIssue[] = [];
  if (!isRecord(record)) {
    push(
      issues,
      "error",
      "record_not_object",
      "Trace record must be an object",
      context,
    );
    return { valid: false, kind: "unknown", issues };
  }

  const kind = detectKind(record);
  const sessionId = stringValue(record, "sessionId") ?? context.sessionId;
  const runId = stringValue(record, "runId") ?? context.runId;
  const turnNumber = numberValue(record, "turnNumber") ?? context.turnNumber;
  const base = { ...context, sessionId, runId, turnNumber };

  if (!stringValue(record, "schemaVersion")) {
    push(
      issues,
      "warning",
      "missing_schema_version",
      "Trace record is missing schemaVersion",
      base,
    );
  }
  if (!stringValue(record, "recordedAt")) {
    push(
      issues,
      "warning",
      "missing_recorded_at",
      "Trace record is missing recordedAt",
      base,
    );
  }

  if (kind === "agent.turn") {
    if (!sessionId)
      push(
        issues,
        "error",
        "missing_session_id",
        "Turn is missing sessionId",
        base,
      );
    if (turnNumber == null)
      push(
        issues,
        "error",
        "missing_turn_number",
        "Turn is missing turnNumber",
        base,
      );
    if (!isRecord(record.snapshot))
      push(
        issues,
        "error",
        "missing_snapshot",
        "Turn is missing snapshot",
        base,
      );
    if (!isRecord(record.llmRequest))
      push(
        issues,
        "error",
        "missing_llm_request",
        "Turn is missing llmRequest",
        base,
      );
    if (!isRecord(record.llmResponse))
      push(
        issues,
        "error",
        "missing_llm_response",
        "Turn is missing llmResponse",
        base,
      );
    if (!Array.isArray(record.toolExecutions))
      push(
        issues,
        "error",
        "missing_tool_executions",
        "Turn toolExecutions must be an array",
        base,
      );
    if (!Array.isArray(record.events))
      push(
        issues,
        "error",
        "missing_events",
        "Turn events must be an array",
        base,
      );
    if (!stringValue(record, "turnId"))
      push(
        issues,
        "warning",
        "missing_turn_id",
        "Turn is missing stable turnId",
        base,
      );
  } else if (kind === "agent.session") {
    if (!sessionId)
      push(
        issues,
        "error",
        "missing_session_id",
        "Session is missing sessionId",
        base,
      );
    if (!stringValue(record, "query"))
      push(
        issues,
        "warning",
        "missing_query",
        "Session is missing query",
        base,
      );
    if (!stringValue(record, "outcome"))
      push(
        issues,
        "error",
        "missing_outcome",
        "Session is missing outcome",
        base,
      );
    if (numberValue(record, "startTime") == null)
      push(
        issues,
        "error",
        "missing_start_time",
        "Session is missing startTime",
        base,
      );
    if (numberValue(record, "endTime") == null)
      push(
        issues,
        "error",
        "missing_end_time",
        "Session is missing endTime",
        base,
      );
  } else if (kind === "orchestrator.run.event") {
    if (!runId)
      push(
        issues,
        "error",
        "missing_run_id",
        "Run event is missing runId",
        base,
      );
    if (!stringValue(record, "type"))
      push(
        issues,
        "error",
        "missing_event_type",
        "Run event is missing type",
        base,
      );
  } else if (kind === "orchestrator.run.manifest") {
    if (!runId)
      push(
        issues,
        "error",
        "missing_run_id",
        "Run manifest is missing runId",
        base,
      );
    if (!stringValue(record, "startedAt"))
      push(
        issues,
        "error",
        "missing_started_at",
        "Run manifest is missing startedAt",
        base,
      );
    if (!stringValue(record, "source"))
      push(
        issues,
        "warning",
        "missing_source",
        "Run manifest is missing source",
        base,
      );
  } else {
    push(
      issues,
      "error",
      "unknown_record_kind",
      "Trace record kind could not be inferred",
      base,
    );
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    kind,
    issues,
  };
}

export function validateTraceBundle(
  input: TraceBundleValidationInput,
): TraceValidationIssue[] {
  const issues: TraceValidationIssue[] = [];
  const indexedSessions = new Set<string>();

  for (const session of input.sessions) {
    const result = validateTraceRecord(session, {
      sessionId: session.sessionId,
    });
    issues.push(...result.issues);
    if (indexedSessions.has(session.sessionId)) {
      push(
        issues,
        "error",
        "duplicate_session",
        `Duplicate session index entry ${session.sessionId}`,
        {
          sessionId: session.sessionId,
        },
      );
    }
    indexedSessions.add(session.sessionId);
    if (!input.entriesBySession.has(session.sessionId)) {
      push(
        issues,
        "warning",
        "missing_trace_file",
        `Session ${session.sessionId} has no turn JSONL file`,
        {
          sessionId: session.sessionId,
        },
      );
    }
  }

  for (const [sessionId, entries] of input.entriesBySession) {
    if (!indexedSessions.has(sessionId)) {
      push(
        issues,
        "warning",
        "orphan_trace_file",
        `Trace file ${sessionId}.jsonl has no session index entry`,
        {
          sessionId,
        },
      );
    }
    const seenTurns = new Set<number>();
    let previousTurn: number | null = null;
    for (const entry of entries) {
      const result = validateTraceRecord(entry, {
        sessionId,
        turnNumber: entry.turnNumber,
      });
      issues.push(...result.issues);
      if (entry.sessionId !== sessionId) {
        push(
          issues,
          "error",
          "session_mismatch",
          `Turn belongs to ${entry.sessionId}, not file session ${sessionId}`,
          {
            sessionId,
            turnNumber: entry.turnNumber,
          },
        );
      }
      if (seenTurns.has(entry.turnNumber)) {
        push(
          issues,
          "error",
          "duplicate_turn",
          `Duplicate turn ${entry.turnNumber}`,
          {
            sessionId,
            turnNumber: entry.turnNumber,
          },
        );
      }
      if (typeof entry.turnNumber === "number") {
        if (previousTurn != null && entry.turnNumber < previousTurn) {
          push(
            issues,
            "warning",
            "out_of_order_turn",
            `Turn ${entry.turnNumber} appears after turn ${previousTurn}`,
            {
              sessionId,
              turnNumber: entry.turnNumber,
            },
          );
        } else if (previousTurn != null && entry.turnNumber > previousTurn + 1) {
          push(
            issues,
            "warning",
            "missing_turn_gap",
            `Trace jumps from turn ${previousTurn} to ${entry.turnNumber}`,
            {
              sessionId,
              turnNumber: entry.turnNumber,
            },
          );
        }
        previousTurn = entry.turnNumber;
      }
      seenTurns.add(entry.turnNumber);
      if (
        entry.perception?.screenshotStatus === "captured" &&
        input.screenshotFiles &&
        !input.screenshotFiles.has(`${sessionId}-T${entry.turnNumber}.jpg`)
      ) {
        push(
          issues,
          "warning",
          "missing_screenshot",
          `Screenshot for turn ${entry.turnNumber} is missing`,
          {
            sessionId,
            turnNumber: entry.turnNumber,
          },
        );
      }
    }
  }

  if (input.screenshotFiles) {
    for (const file of input.screenshotFiles) {
      const match = file.match(/^(.+)-T\d+(?:-pan\d+)?\.jpg$/);
      if (match && !input.entriesBySession.has(match[1])) {
        push(
          issues,
          "warning",
          "orphan_screenshot",
          `Screenshot ${file} has no trace file`,
          {
            sessionId: match[1],
          },
        );
      }
    }
  }

  if (input.runEventsByRun) {
    for (const [runId, events] of input.runEventsByRun) {
      for (const event of events) {
        const result = validateTraceRecord(event, { runId });
        issues.push(...result.issues);
      }
      validateParallelRunEvents(runId, events, issues);
    }
  }

  return issues;
}

export function validateFrozenTraceBundle(
  bundle: FrozenTraceBundle,
): TraceValidationIssue[] {
  const issues: TraceValidationIssue[] = [];
  if (bundle.schemaVersion !== "2026-05-30") {
    push(
      issues,
      "error",
      "unsupported_frozen_bundle_schema",
      `Unsupported frozen bundle schema ${String(bundle.schemaVersion)}`,
      { sessionId: bundle.session?.sessionId },
    );
  }
  if (bundle.traceKind !== "trace.viewer.frozen_bundle") {
    push(
      issues,
      "error",
      "invalid_frozen_bundle_kind",
      "Frozen bundle traceKind must be trace.viewer.frozen_bundle",
      { sessionId: bundle.session?.sessionId },
    );
  }
  if (!Number.isFinite(Date.parse(bundle.frozenAt))) {
    push(
      issues,
      "error",
      "invalid_frozen_at",
      "Frozen bundle frozenAt must be an ISO timestamp",
      { sessionId: bundle.session?.sessionId },
    );
  }

  const sessionId = bundle.session.sessionId;
  const screenshotFiles = new Set(
    (bundle.screenshots ?? [])
      .map((screenshot) => screenshot.fileName)
      .filter((fileName): fileName is string => Boolean(fileName)),
  );
  issues.push(
    ...validateTraceBundle({
      sessions: [bundle.session],
      entriesBySession: new Map([[sessionId, bundle.entries ?? []]]),
      runEventsByRun: bundle.session.runId
        ? new Map([[bundle.session.runId, bundle.runEvents ?? []]])
        : undefined,
      screenshotFiles:
        screenshotFiles.size > 0 ? screenshotFiles : undefined,
    }),
  );

  for (const screenshot of bundle.screenshots ?? []) {
    if (!screenshot.dataUrl && !screenshot.fileName) {
      push(
        issues,
        "error",
        "frozen_screenshot_missing_blob",
        "Frozen screenshot must include dataUrl or fileName",
        {
          sessionId: screenshot.sessionId,
          turnNumber: screenshot.turnNumber,
        },
      );
    }
    if (screenshot.sessionId !== sessionId) {
      push(
        issues,
        "error",
        "frozen_screenshot_session_mismatch",
        `Frozen screenshot belongs to ${screenshot.sessionId}, not ${sessionId}`,
        {
          sessionId: screenshot.sessionId,
          turnNumber: screenshot.turnNumber,
        },
      );
    }
  }

  return issues;
}
