export type RunEnvironment = "production" | "eval";

export interface RunPromptRef {
  id: string;
  version: string;
  hash: string;
}

export interface RunManifest {
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

export class RunTraceWriter {
  private _write: RunTraceWrite;

  constructor(write: RunTraceWrite) {
    this._write = write;
  }

  async emitManifest(manifest: RunManifest): Promise<void> {
    await this._write({ kind: "manifest", manifest });
  }

  async emitEvent(event: Omit<RunTraceEvent, "ts">): Promise<void> {
    await this._write({
      kind: "event",
      event: {
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
