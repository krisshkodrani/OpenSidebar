export type RunEnvironment = "production" | "eval";

export interface RunPromptRef {
  id: string;
  version: string;
  hash: string;
}

export interface RunManifest {
  /** Trace schema version (optional for backward compatibility with older run traces) */
  schemaVersion?: "2026-02-19";
  /** Trace record kind (optional for backward compatibility with older run traces) */
  traceKind?: "orchestrator.run.manifest";
  /** ISO timestamp when this record was emitted (optional for backward compatibility) */
  recordedAt?: string;
  /** Component that emitted this record (optional for backward compatibility) */
  producer?: "background.orchestrator.run-trace-writer";
  /** End-to-end correlation ID spanning orchestrator + agent trace streams */
  correlationId?: string;
  /** Parent run for nested/derived executions (future-proofing) */
  parentRunId?: string;
  /** Linked agent session ID when applicable */
  sessionId?: string;
  runId: string;
  environment: RunEnvironment;
  startedAt: string;
  source: string;
  promptSet: RunPromptRef[];
  model?: string;
  provider?: string;
  codeVersion?: string;
  caseId?: string;
  taskId?: string;
  workspaceId?: string;
}

export interface RunTraceEvent {
  /** Trace schema version (optional for backward compatibility with older run traces) */
  schemaVersion?: "2026-02-19";
  /** Trace record kind (optional for backward compatibility with older run traces) */
  traceKind?: "orchestrator.run.event";
  /** ISO timestamp when this record was emitted (optional for backward compatibility) */
  recordedAt?: string;
  /** Component that emitted this record (optional for backward compatibility) */
  producer?: "background.orchestrator.run-trace-writer";
  /** End-to-end correlation ID spanning orchestrator + agent trace streams */
  correlationId?: string;
  /** Parent run for nested/derived executions (future-proofing) */
  parentRunId?: string;
  /** Linked agent session ID when applicable */
  sessionId?: string;
  runId: string;
  ts: string;
  type: string;
  turn?: number;
  role?: "planner" | "executor" | "verifier" | "system";
  data?: Record<string, unknown>;
}

export type RunTraceRecord =
  | { kind: "manifest"; manifest: RunManifest }
  | { kind: "event"; event: RunTraceEvent };

type RunTraceWrite = (record: RunTraceRecord) => void | Promise<void>;

const TRACE_SCHEMA_VERSION = "2026-02-19" as const;
const TRACE_PRODUCER = "background.orchestrator.run-trace-writer" as const;

export class RunTraceWriter {
  private _write: RunTraceWrite;

  constructor(write: RunTraceWrite) {
    this._write = write;
  }

  async emitManifest(manifest: RunManifest): Promise<void> {
    await this._write({
      kind: "manifest",
      manifest: {
        schemaVersion: TRACE_SCHEMA_VERSION,
        traceKind: "orchestrator.run.manifest",
        recordedAt: new Date().toISOString(),
        producer: TRACE_PRODUCER,
        correlationId: manifest.correlationId ?? manifest.runId,
        ...manifest,
      },
    });
  }

  async emitEvent(event: Omit<RunTraceEvent, "ts">): Promise<void> {
    await this._write({
      kind: "event",
      event: {
        schemaVersion: TRACE_SCHEMA_VERSION,
        traceKind: "orchestrator.run.event",
        recordedAt: new Date().toISOString(),
        producer: TRACE_PRODUCER,
        correlationId: event.correlationId ?? event.runId,
        ...event,
        ts: new Date().toISOString(),
      },
    });
  }
}

const DEFAULT_RUN_TRACE_SERVER_URL = "http://127.0.0.1:7589";
const DEFAULT_FLUSH_TIMEOUT_MS = 2000;

async function postJson(
  url: string,
  payload: unknown,
  timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createHttpRunTraceWriter(
  serverUrl = DEFAULT_RUN_TRACE_SERVER_URL,
): RunTraceWriter {
  const base = serverUrl.replace(/\/+$/, "");
  return new RunTraceWriter(async (record) => {
    if (record.kind === "manifest") {
      await postJson(`${base}/run-traces/session`, record.manifest);
      return;
    }
    await postJson(`${base}/run-traces`, record.event);
  });
}
