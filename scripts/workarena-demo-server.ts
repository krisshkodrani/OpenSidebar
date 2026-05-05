#!/usr/bin/env tsx

import http from "http";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createInterface, type Interface } from "readline";
import { resolve } from "path";
import {
  PROJECT_ROOT,
  loadDotEnv,
  readinessLabel,
  resolvePythonExecutable,
  runWorkArenaDoctor,
  withReadiness,
} from "./workarena-adapter-lib.js";

const SESSION_BRIDGE_PATH = resolve(PROJECT_ROOT, "scripts", "workarena-session-bridge.py");
const DEFAULT_PORT = 7595;
const DEFAULT_TASK = "workarena.servicenow.all-menu";
const DEFAULT_SEED = 0;

type JsonRecord = Record<string, unknown>;

type Args = {
  port: number;
  taskId: string;
  seed: number;
  showBrowser: boolean;
  allowServiceNowReset: boolean;
};

type SessionState = {
  status: "idle" | "starting" | "active" | "failed" | "tearing_down";
  taskId: string | null;
  seed: number | null;
  reset: JsonRecord | null;
  exportSession: JsonRecord | null;
  validation: JsonRecord | null;
  error: string | null;
  startedAt: string | null;
  updatedAt: string;
};

class WorkArenaSessionBridgeClient {
  private child: ChildProcessWithoutNullStreams;
  private lines: JsonRecord[] = [];
  private waiters: Array<(line: JsonRecord) => void> = [];
  private stderr = "";
  private readline: Interface;
  private exited = false;

  constructor() {
    this.child = spawn(resolvePythonExecutable(), [SESSION_BRIDGE_PATH], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...loadDotEnv(),
      },
      windowsHide: true,
    });

    this.child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk);
    });

    this.readline = createInterface({ input: this.child.stdout });
    this.readline.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        this.pushLine(JSON.parse(trimmed) as JsonRecord);
      } catch {
        this.pushLine({
          ok: false,
          status: "invalid_bridge_json",
          error: trimmed.slice(0, 1000),
        });
      }
    });

    this.child.on("exit", () => {
      this.exited = true;
    });
  }

  async description(): Promise<JsonRecord> {
    return await this.nextLine();
  }

  async request(message: JsonRecord, timeoutMs = 120_000): Promise<JsonRecord> {
    if (this.exited) {
      throw new Error(`WorkArena session bridge exited. ${this.stderr.trim()}`);
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return await this.nextLine(timeoutMs);
  }

  async close(): Promise<JsonRecord | null> {
    let teardown: JsonRecord | null = null;
    if (!this.exited) {
      try {
        teardown = await this.request({ command: "teardown" }, 60_000);
      } catch {
        // Process cleanup follows.
      }
      this.child.stdin.end();
    }

    await new Promise<void>((resolveClose) => {
      const timer = setTimeout(() => {
        if (!this.exited) this.child.kill("SIGKILL");
        resolveClose();
      }, 5_000);
      this.child.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
    this.readline.close();
    return teardown;
  }

  private pushLine(line: JsonRecord): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
      return;
    }
    this.lines.push(line);
  }

  private nextLine(timeoutMs = 120_000): Promise<JsonRecord> {
    const existing = this.lines.shift();
    if (existing) return Promise.resolve(existing);

    return new Promise((resolveLine, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for WorkArena bridge. ${this.stderr.trim()}`));
      }, timeoutMs);
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolveLine(line);
      });
    });
  }
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const value = (name: string): string | null => {
    const index = args.indexOf(name);
    if (index < 0) return null;
    const next = args[index + 1];
    return next && !next.startsWith("--") ? next : null;
  };
  const port = Number.parseInt(value("--port") ?? "", 10);
  const seed = Number.parseInt(value("--seed") ?? "", 10);
  return {
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    taskId: value("--task") ?? DEFAULT_TASK,
    seed: Number.isFinite(seed) ? seed : DEFAULT_SEED,
    showBrowser: !args.includes("--headless"),
    allowServiceNowReset:
      args.includes("--allow-servicenow-reset") || args.includes("--reset"),
  };
}

function now(): string {
  return new Date().toISOString();
}

function initialState(): SessionState {
  return {
    status: "idle",
    taskId: null,
    seed: null,
    reset: null,
    exportSession: null,
    validation: null,
    error: null,
    startedAt: null,
    updatedAt: now(),
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res: http.ServerResponse, args: Args): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenSidebar WorkArena Demo</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; max-width: 980px; }
    button { margin-right: 8px; padding: 8px 12px; }
    pre { background: #111827; color: #e5e7eb; padding: 16px; overflow: auto; }
    .warn { color: #92400e; }
  </style>
</head>
<body>
  <h1>OpenSidebar WorkArena Demo</h1>
  <p>Task: <code>${escapeHtml(args.taskId)}</code>, seed <code>${args.seed}</code></p>
  ${
    args.allowServiceNowReset
      ? ""
      : '<p class="warn">Server started without --allow-servicenow-reset. /start will be blocked.</p>'
  }
  <button onclick="post('/start')">Start visible session</button>
  <button onclick="post('/export')">Export session</button>
  <button onclick="post('/validate')">Validate</button>
  <button onclick="post('/teardown')">Teardown</button>
  <button onclick="refresh()">Refresh</button>
  <pre id="out">Loading...</pre>
  <script>
    async function refresh() {
      const response = await fetch('/status');
      document.getElementById('out').textContent = JSON.stringify(await response.json(), null, 2);
    }
    async function post(path) {
      const response = await fetch(path, { method: 'POST' });
      document.getElementById('out').textContent = JSON.stringify(await response.json(), null, 2);
    }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}

function optionalString(
  record: JsonRecord,
  key: string,
  maxLength: number,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function readRequestBody(req: http.IncomingMessage): Promise<JsonRecord> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      reject(error);
      req.destroy();
    };
    req.on("data", (chunk) => {
      body += String(chunk);
      if (body.length > 50_000) {
        fail(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (!body.trim()) {
        resolveBody({});
        return;
      }
      try {
        const parsed = JSON.parse(body) as unknown;
        resolveBody(
          typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as JsonRecord)
            : {},
        );
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs();
  let state = initialState();
  let bridge: WorkArenaSessionBridgeClient | null = null;
  let sessionLock = Promise.resolve();

  async function withSessionLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = sessionLock;
    let release!: () => void;
    sessionLock = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async function teardown(): Promise<JsonRecord> {
    state = { ...state, status: "tearing_down", updatedAt: now() };
    const teardownResult = bridge ? await bridge.close() : null;
    bridge = null;
    state = {
      ...initialState(),
      validation: state.validation,
      updatedAt: now(),
    };
    return { ok: true, status: "teardown_complete", teardown: teardownResult, state };
  }

  async function start(payload: JsonRecord): Promise<JsonRecord> {
    if (!args.allowServiceNowReset) {
      return {
        ok: false,
        status: "blocked_requires_server_reset_flag",
        error: "Restart the demo server with --allow-servicenow-reset to enable /start.",
        state,
      };
    }

    const doctor = withReadiness(runWorkArenaDoctor(false));
    if (!doctor.ready) {
      return {
        ok: false,
        status: "blocked_setup",
        error: `Setup is not fully ready: ${readinessLabel(doctor.readiness ?? "blocked")}.`,
        doctor,
        state,
      };
    }

    if (bridge) await teardown();

    const taskId = typeof payload.task === "string" ? payload.task : args.taskId;
    const seed = typeof payload.seed === "number" ? payload.seed : args.seed;
    state = {
      ...initialState(),
      status: "starting",
      taskId,
      seed,
      startedAt: now(),
      updatedAt: now(),
    };

    bridge = new WorkArenaSessionBridgeClient();
    const description = await bridge.description();
    const reset = await bridge.request(
      {
        command: "reset",
        taskId,
        seed,
        allowServiceNowReset: true,
        showBrowser: args.showBrowser,
      },
      180_000,
    );
    if (reset.ok !== true) {
      state = {
        ...state,
        status: "failed",
        reset,
        error: typeof reset.error === "string" ? reset.error : "WorkArena reset failed",
        updatedAt: now(),
      };
      return { ok: false, status: "reset_failed", description, state };
    }

    const exportSession = await bridge.request({ command: "export_session" }, 60_000);
    state = {
      ...state,
      status: "active",
      reset,
      exportSession,
      error: null,
      updatedAt: now(),
    };
    return { ok: true, status: "active", description, state };
  }

  async function exportSession(): Promise<JsonRecord> {
    if (!bridge || state.status !== "active") {
      return { ok: false, status: "no_active_session", state };
    }
    const result = await bridge.request({ command: "export_session" }, 60_000);
    state = { ...state, exportSession: result, updatedAt: now() };
    return { ok: true, status: "session_exported", state };
  }

  async function validate(payload: JsonRecord): Promise<JsonRecord> {
    if (!bridge || state.status !== "active") {
      return { ok: false, status: "no_active_session", state };
    }
    const result = await bridge.request(
      {
        command: "validate",
        activeUrl: optionalString(payload, "activeUrl", 2_000),
        submittedRecordNumber: optionalString(payload, "submittedRecordNumber", 200),
        finalAnswer: optionalString(payload, "finalAnswer", 10_000),
      },
      120_000,
    );
    state = { ...state, validation: result, updatedAt: now() };
    return { ok: true, status: "validated", state };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/") {
        sendHtml(res, args);
        return;
      }
      if (req.method === "GET" && url.pathname === "/status") {
        sendJson(res, 200, { ok: true, state });
        return;
      }
      if (req.method === "POST" && url.pathname === "/start") {
        const body = await readRequestBody(req);
        sendJson(res, 200, await withSessionLock(() => start(body)));
        return;
      }
      if (req.method === "POST" && url.pathname === "/export") {
        sendJson(res, 200, await withSessionLock(() => exportSession()));
        return;
      }
      if (req.method === "POST" && url.pathname === "/validate") {
        const body = await readRequestBody(req);
        sendJson(res, 200, await withSessionLock(() => validate(body)));
        return;
      }
      if (req.method === "POST" && url.pathname === "/teardown") {
        sendJson(res, 200, await withSessionLock(() => teardown()));
        return;
      }
      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        state,
      });
    }
  });

  const shutdown = async () => {
    if (bridge) await withSessionLock(() => teardown());
    server.close();
  };
  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  server.listen(args.port, "127.0.0.1", () => {
    console.log(`[workarena:demo] Server: http://127.0.0.1:${args.port}`);
    console.log(`[workarena:demo] Task: ${args.taskId}`);
    console.log(`[workarena:demo] Seed: ${args.seed}`);
    console.log(
      `[workarena:demo] Reset enabled: ${args.allowServiceNowReset ? "yes" : "no"}`,
    );
  });
}

main().catch((error) => {
  console.error("[workarena:demo] Fatal error:", error);
  process.exit(1);
});
