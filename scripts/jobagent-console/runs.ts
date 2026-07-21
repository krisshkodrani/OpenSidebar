/**
 * JobAgent console run manager (pi Phase 9, v2).
 *
 * Owns the two kinds of browser-consuming work and the ONE invariant that
 * makes them safe together: a single WS-bridge port owner and a single
 * active run at a time (one async mutex guards both).
 *
 *  - Discovery runs SPAWN pi (the reasoning brain sweeps boards); while pi
 *    is alive the console's own bridge is released so pi's lazily-created
 *    bridge can bind the port. Reacquired with retry on exit.
 *  - Fill/submit runs DON'T need pi: the kit brief is deterministic, so the
 *    console calls `browser_run_task` on its own bridge, and when the
 *    Phase-4 gate pauses the mission with a ForwardedApprovalRequest, the
 *    approval lands in the inbox. A human decision resolves it via
 *    `browser_respond_approval` on the same session — the respond call
 *    returns the resumed mission's NEXT outcome, which may be another
 *    pause (loop).
 *
 * All state transitions go through `recordStatus` (the ratchet stays the
 * only authority); every run/approval transition is appended to JSONL audit
 * files in the seed dir. Dependencies are injected so tests never open
 * sockets or spawn processes.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";

import type {
  BrowserToolResponse,
  ForwardedApprovalRequest,
} from "../browser-mcp/bridge";
import {
  assembleFillBrief,
  loadApplication,
  recordStatus,
  resolveSeedDir,
  startCvServer,
  type CvServer,
} from "../jobagent/index";
import type { ConsoleEvent } from "./events";

/* ── Injectable seam ──────────────────────────────────────── */

export interface ConsoleBridge {
  readonly connected: boolean;
  call(
    request: { tool: string; args: Record<string, unknown>; session?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<BrowserToolResponse>;
  close(): Promise<void>;
}

export interface PiProcess {
  onLine(cb: (line: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

export interface RunManagerDeps {
  createBridge(): Promise<ConsoleBridge>;
  spawnPi(mission: string): PiProcess;
  startCvServer: typeof startCvServer;
  now(): number;
  emit(event: ConsoleEvent): void;
  appendAudit?(file: string, record: unknown): void;
  /**
   * Is the dev log server (127.0.0.1:7589) accepting trace POSTs? The
   * extension's trace recorder fires-and-forgets at that address and only
   * logs failures at debug level, so without this probe a run that produced
   * NO durable agent trace is indistinguishable from one that did.
   */
  probeTraceServer?(): Promise<boolean>;
  /** Append one line to a run's durable log (defaults to the seed dir). */
  appendRunLog?(runId: string, line: string): void;
}

/* ── Records ──────────────────────────────────────────────── */

export type RunKind = "discovery" | "fill" | "submit";
export type RunState =
  | "running"
  | "awaiting-approval"
  | "ok"
  | "failed"
  | "expired"
  | "denied"
  | "needs-attention"
  | "canceled";

export interface RunRecord {
  id: string;
  kind: RunKind;
  name?: string;
  state: RunState;
  startedAt: number;
  endedAt?: number;
  outcomeSummary?: string;
  handoff?: unknown;
  log: string[];
  /**
   * Whether the agent-trace sink was reachable when this run started. "down"
   * means the turn-by-turn agent trace for this run was NOT persisted — the
   * console log is then the only surviving record of what the agent did.
   */
  traceServer?: "up" | "down";
}

export type ApprovalState = "pending" | "approved" | "denied" | "expired";

export interface ApprovalItem extends ForwardedApprovalRequest {
  runId: string;
  name: string;
  state: ApprovalState;
}

export type BridgeOwner = "console" | "pi-run" | "released";

/* ── Manager ──────────────────────────────────────────────── */

const DISCOVERY_MISSION =
  "Run the JobAgent discovery loop: (1) jobagent_search_criteria; (2) for each " +
  "board: browser_navigate its searchUrl, browser_extract_structured the visible " +
  "listings as {title, company, url, location, snippet}, and pass EVERY plausible " +
  "listing to jobagent_record_discovery verbatim with source = the board name; " +
  "(3) stop once maxPackagesPerRun is reached; (4) report created/duplicate/" +
  "rejected counts with reasons and stop. Do NOT apply to, fill, or submit " +
  "anything. If a browser tool reports not connected, browser_ping and retry once.";

export class RunManager {
  private bridge: ConsoleBridge | null = null;
  private owner: BridgeOwner = "released";
  private busy: Promise<void> = Promise.resolve();
  private runs = new Map<string, RunRecord>();
  private approvals = new Map<string, ApprovalItem>();
  private waiters = new Map<string, (approved: boolean) => void>();
  private aborts = new Map<string, AbortController>();
  private seq = 0;

  constructor(private deps: RunManagerDeps) {}

  /* — bridge lifecycle — */

  async start(): Promise<void> {
    this.bridge = await this.deps.createBridge();
    this.owner = "console";
    this.emitBridge();
  }

  async stop(): Promise<void> {
    await this.bridge?.close().catch(() => {});
    this.bridge = null;
    this.owner = "released";
  }

  bridgeStatus(): { owner: BridgeOwner; extensionConnected: boolean } {
    return {
      owner: this.owner,
      extensionConnected: this.bridge?.connected ?? false,
    };
  }

  private emitBridge(): void {
    this.deps.emit({ type: "bridge-status", data: this.bridgeStatus() });
  }

  /* — registries — */

  listRuns(): RunRecord[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  getRun(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  listApprovals(): { pending: ApprovalItem[]; resolved: ApprovalItem[] } {
    const all = [...this.approvals.values()];
    return {
      pending: all.filter((a) => a.state === "pending"),
      resolved: all.filter((a) => a.state !== "pending"),
    };
  }

  hasActiveRun(): boolean {
    return [...this.runs.values()].some(
      (r) => r.state === "running" || r.state === "awaiting-approval",
    );
  }

  cancelRun(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || (run.state !== "running" && run.state !== "awaiting-approval")) {
      return false;
    }
    // Mark canceled FIRST — abort side effects (pi exit handlers, bridge
    // rejections) check the run state and must not relabel it "failed".
    const abort = this.aborts.get(id);
    this.finishRun(run, "canceled", "canceled by user");
    abort?.abort();
    // A pending approval for this run dies with it.
    for (const approval of this.approvals.values()) {
      if (approval.runId === id && approval.state === "pending") {
        approval.state = "denied";
        this.waiters.get(approval.approvalId)?.(false);
      }
    }
    return true;
  }

  /** Resolve a pending approval from the UI. */
  resolveApproval(
    approvalId: string,
    approved: boolean,
  ): { status: number; body: unknown } {
    const item = this.approvals.get(approvalId);
    if (!item) return { status: 404, body: { error: "unknown approval" } };
    if (item.state !== "pending") {
      return { status: 410, body: { error: `approval already ${item.state}` } };
    }
    if (this.deps.now() > item.expiresAt) {
      item.state = "expired";
      this.audit("console-approvals.jsonl", { ...item });
      this.waiters.get(approvalId)?.(false);
      return { status: 410, body: { error: "approval expired" } };
    }
    item.state = approved ? "approved" : "denied";
    this.audit("console-approvals.jsonl", { ...item });
    this.deps.emit({
      type: "approval-resolved",
      data: { approvalId, state: item.state },
    });
    const waiter = this.waiters.get(approvalId);
    if (!waiter) return { status: 410, body: { error: "no waiter for approval" } };
    waiter(approved);
    return { status: 200, body: { approvalId, state: item.state } };
  }

  /* — runs — */

  startDiscovery(): { status: number; body: unknown } {
    if (this.hasActiveRun()) {
      return { status: 409, body: { error: "another run is active" } };
    }
    const run = this.createRun("discovery");
    this.busy = this.busy.then(() => this.runDiscovery(run)).catch(() => {});
    return { status: 200, body: { runId: run.id } };
  }

  startFill(name: string, mode: "fill" | "submit"): { status: number; body: unknown } {
    if (this.hasActiveRun()) {
      return { status: 409, body: { error: "another run is active" } };
    }
    let app: ReturnType<typeof loadApplication>;
    try {
      app = loadApplication(name);
    } catch (e) {
      return { status: 404, body: { error: e instanceof Error ? e.message : String(e) } };
    }
    const status = app.package.status ?? "reviewing";
    if (mode === "fill" && status !== "ready") {
      return { status: 409, body: { error: `fill needs status "ready", have "${status}"` } };
    }
    if (mode === "submit" && status !== "filled-awaiting-submit") {
      return {
        status: 409,
        body: { error: `submit needs status "filled-awaiting-submit", have "${status}"` },
      };
    }
    const run = this.createRun(mode, name);
    this.busy = this.busy.then(() => this.runFill(run, name, mode)).catch(() => {});
    return { status: 200, body: { runId: run.id } };
  }

  /* — internals — */

  private createRun(kind: RunKind, name?: string): RunRecord {
    const run: RunRecord = {
      id: `run-${++this.seq}-${this.deps.now().toString(36)}`,
      kind,
      name,
      state: "running",
      startedAt: this.deps.now(),
      log: [],
    };
    this.runs.set(run.id, run);
    this.aborts.set(run.id, new AbortController());
    this.audit("console-runs.jsonl", { event: "started", ...run, log: undefined });
    this.deps.emit({ type: "run-status", data: this.publicRun(run) });
    return run;
  }

  private publicRun(run: RunRecord): Omit<RunRecord, "log"> & { logLength: number } {
    const { log, ...rest } = run;
    return { ...rest, logLength: log.length };
  }

  private logLine(run: RunRecord, line: string): void {
    run.log.push(line);
    // Written through on every line, not at finishRun: a live fill dies with
    // the browser it drives, and a finish-time write loses the whole log
    // exactly when the run failed in the way most worth reading about.
    this.runLog(run.id, line);
    this.deps.emit({ type: "run-log", data: { runId: run.id, line } });
  }

  private runLog(runId: string, line: string): void {
    if (this.deps.appendRunLog) return this.deps.appendRunLog(runId, line);
    const path = join(resolveSeedDir(), "jobagent", "run-logs", `${runId}.log`);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${new Date(this.deps.now()).toISOString()} ${line}\n`, "utf8");
  }

  /**
   * Record whether the agent trace for this run will survive it. Best-effort:
   * a probe failure is reported as "down" rather than aborting the run.
   */
  private async checkTraceSink(run: RunRecord): Promise<void> {
    const up = this.deps.probeTraceServer
      ? await this.deps.probeTraceServer().catch(() => false)
      : false;
    run.traceServer = up ? "up" : "down";
    if (!up) {
      this.logLine(
        run,
        "[console] WARNING: no trace sink on 127.0.0.1:7589 — the agent's " +
          "turn-by-turn trace will NOT be persisted for this run. Start one " +
          "with `pnpm run logs` (and load dist-dev, not dist) for a full audit " +
          "trail.",
      );
    }
  }

  private finishRun(run: RunRecord, state: RunState, summary?: string): void {
    if (run.endedAt) return;
    run.state = state;
    run.endedAt = this.deps.now();
    run.outcomeSummary = summary;
    this.aborts.delete(run.id);
    this.audit("console-runs.jsonl", { event: "finished", ...run, log: undefined });
    this.deps.emit({ type: "run-status", data: this.publicRun(run) });
    this.deps.emit({ type: "queue-changed", data: { runId: run.id } });
  }

  private async runDiscovery(run: RunRecord): Promise<void> {
    // Release the port so pi's bridge can bind it.
    await this.bridge?.close().catch(() => {});
    this.bridge = null;
    this.owner = "pi-run";
    this.emitBridge();

    try {
      await new Promise<void>((done) => {
        const child = this.deps.spawnPi(DISCOVERY_MISSION);
        const abort = this.aborts.get(run.id);
        abort?.signal.addEventListener("abort", () => child.kill());
        child.onLine((line) => this.logLine(run, line));
        child.onExit((code) => {
          if (run.state === "running") {
            this.finishRun(
              run,
              code === 0 ? "ok" : "failed",
              `pi exited with code ${code}`,
            );
          }
          done();
        });
      });
    } finally {
      // Reacquire the port (pi's unref()ed server dies with the process, but
      // give the OS a beat).
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          this.bridge = await this.deps.createBridge();
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      this.owner = this.bridge ? "console" : "released";
      this.emitBridge();
    }
  }

  private async runFill(
    run: RunRecord,
    name: string,
    mode: "fill" | "submit",
  ): Promise<void> {
    if (!this.bridge) {
      return this.finishRun(run, "failed", "console bridge is not up");
    }
    const signal = this.aborts.get(run.id)!.signal;
    let cvServer: CvServer | null = null;
    // Before anything touches a real employer's form: is this run auditable?
    await this.checkTraceSink(run);
    try {
      const app = loadApplication(name);
      let cvUrl: string | undefined;
      if (app.manifest.cvServe) {
        cvServer = await this.deps.startCvServer(
          resolvePath(app.dir, app.manifest.cvServe.dir),
          app.manifest.cvServe.file,
        );
        cvUrl = cvServer.url;
      }
      const instruction =
        mode === "fill"
          ? assembleFillBrief(app.package, app.manifest, cvUrl)
          : `Open ${app.manifest.formUrl} — the application form was already ` +
            `filled in this browser. Verify the previously filled values are ` +
            `still present, then submit the application form. Stop after the ` +
            `submit outcome is visible and report it.`;
      const session = `console-${run.id}`;

      this.logLine(run, `[console] starting ${mode} mission at ${app.manifest.formUrl}`);
      let outcome = await this.bridge.call(
        // `url` is what opens the tab on the form (orchestrator-driver uses
        // task.url for createTab/navigateTab). Without it the agent lands on
        // about:blank and has to navigate itself — which fails outright when
        // the extension is configured with navigation disallowed.
        {
          tool: "browser_run_task",
          args: { instruction, url: app.manifest.formUrl },
          session,
        },
        { signal },
      );

      while (outcome.status === "needs_human" && outcome.approval) {
        const approval = outcome.approval;
        const item: ApprovalItem = { ...approval, runId: run.id, name, state: "pending" };
        this.approvals.set(approval.approvalId, item);
        this.audit("console-approvals.jsonl", { event: "pending", ...item });
        run.state = "awaiting-approval";
        this.deps.emit({ type: "run-status", data: this.publicRun(run) });
        this.deps.emit({ type: "approval-pending", data: item });
        this.logLine(run, `[console] approval requested: ${approval.context}`);

        const approved = await new Promise<boolean>((decide) => {
          this.waiters.set(approval.approvalId, decide);
          const remaining = Math.max(0, approval.expiresAt - this.deps.now());
          const timer = setTimeout(() => {
            if (item.state === "pending") {
              item.state = "expired";
              this.audit("console-approvals.jsonl", { ...item });
              this.deps.emit({
                type: "approval-resolved",
                data: { approvalId: approval.approvalId, state: "expired" },
              });
              decide(false);
            }
          }, remaining);
          timer.unref?.();
        });
        this.waiters.delete(approval.approvalId);

        if (item.state === "expired") {
          // Extension auto-denies at expiry; the mission's completion has no
          // waiter and drops harmlessly. Package status untouched.
          return this.finishRun(run, "expired", "approval expired unanswered");
        }
        run.state = "running";
        this.deps.emit({ type: "run-status", data: this.publicRun(run) });

        outcome = await this.bridge.call(
          {
            tool: "browser_respond_approval",
            args: { approvalId: approval.approvalId, approved },
            session,
          },
          { signal },
        );
        if (!approved) {
          this.logLine(run, "[console] approval denied — no submission");
          return this.finishRun(run, "denied", "human denied the action");
        }
      }

      if (outcome.status === "ok") {
        const result =
          typeof outcome.result === "string"
            ? outcome.result
            : JSON.stringify(outcome.result ?? "");
        this.logLine(run, `[console] mission ok: ${result.slice(0, 400)}`);
        try {
          if (mode === "fill") {
            recordStatus(loadApplication(name).dir, "filled-awaiting-submit");
          } else {
            recordStatus(loadApplication(name).dir, "submitted-by-user");
          }
        } catch (e) {
          this.logLine(
            run,
            `[console] WARNING status not advanced: ${e instanceof Error ? e.message : e}`,
          );
        }
        return this.finishRun(run, "ok", result.slice(0, 200));
      }
      if (outcome.status === "needs_human") {
        run.handoff = outcome.handoff;
        return this.finishRun(run, "needs-attention", outcome.reason);
      }
      return this.finishRun(run, "failed", outcome.reason ?? "error");
    } catch (e) {
      if (signal.aborted) return; // cancelRun already finished it
      this.finishRun(run, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      await cvServer?.close().catch(() => {});
    }
  }

  private audit(file: string, record: unknown): void {
    if (this.deps.appendAudit) return this.deps.appendAudit(file, record);
    const path = join(resolveSeedDir(), "jobagent", file);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      JSON.stringify({ at: this.deps.now(), ...(record as object) }) + "\n",
      "utf8",
    );
  }
}

/* ── Production deps ──────────────────────────────────────── */

export function createProductionDeps(
  emit: (event: ConsoleEvent) => void,
): RunManagerDeps {
  return {
    async createBridge(): Promise<ConsoleBridge> {
      // Lazy import keeps `ws` out of test paths that inject fakes.
      const { WebSocketBridge } = await import("../browser-mcp/ws-bridge");
      const port = Number(process.env.OPENSIDEBAR_WS_PORT ?? 8917);
      const bridge = new WebSocketBridge({ port, timeoutMs: 600_000 });
      await bridge.listening;
      return bridge as unknown as ConsoleBridge;
    },
    async probeTraceServer(): Promise<boolean> {
      // Matches trace.ts's hardcoded TRACE_SERVER_URL; log-server.ts serves
      // /health on the same port (LOG_SERVER_PORT, default 7589).
      const port = Number(process.env.LOG_SERVER_PORT ?? 7589);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1_500),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    spawnPi(mission: string): PiProcess {
      const child = spawn(
        "pi",
        [
          "-e", ".pi/extensions/opensidebar.ts",
          "-e", ".pi/extensions/jobagent.ts",
          "-p", mission,
        ],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          shell: true, // Windows: resolves pi.cmd / pi.ps1 shims
          env: { ...process.env },
        },
      );
      const lineCbs: Array<(line: string) => void> = [];
      const exitCbs: Array<(code: number | null) => void> = [];
      const feed = (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split(/\r?\n/)) {
          if (line.trim()) for (const cb of lineCbs) cb(line);
        }
      };
      child.stdout?.on("data", feed);
      child.stderr?.on("data", feed);
      child.on("exit", (code) => exitCbs.forEach((cb) => cb(code)));
      child.on("error", (e) => {
        lineCbs.forEach((cb) => cb(`[spawn error] ${e.message}`));
        exitCbs.forEach((cb) => cb(-1));
      });
      return {
        onLine: (cb) => lineCbs.push(cb),
        onExit: (cb) => exitCbs.push(cb),
        kill: () => child.kill(),
      };
    },
    startCvServer,
    now: () => Date.now(),
    emit,
  };
}
