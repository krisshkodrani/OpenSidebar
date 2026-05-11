import type {
  TraceBundleValidationInput,
  TraceValidationIssue,
  TraceValidationResult,
} from "./types";

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
    }
  }

  return issues;
}
