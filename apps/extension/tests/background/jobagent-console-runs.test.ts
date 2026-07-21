/**
 * Run manager (pi Phase 9, v2) — the bridge-ownership + fill/approval state
 * machine, tested with a FAKE bridge and FAKE pi (no sockets, no processes).
 * Covers: fill happy path, the approval round trip (pending → human approve →
 * respond_approval on the same session → submitted-by-user), deny, expiry,
 * chained pauses, discovery serialization (bridge closed before pi spawns,
 * recreated after exit), and cancellation.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RunManager,
  type ApprovalItem,
  type ConsoleBridge,
  type PiProcess,
  type RunManagerDeps,
} from "../../../../scripts/jobagent-console/runs";
import type { ConsoleEvent } from "../../../../scripts/jobagent-console/events";

let savedApps: string | undefined;
let savedSeed: string | undefined;
const tmpDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  savedApps = process.env.JOBAGENT_APPLICATIONS_DIR;
  savedSeed = process.env.OPENSIDEBAR_SEED_DIR;
  process.env.OPENSIDEBAR_SEED_DIR = tempDir("runs-seed-");
  process.env.JOBAGENT_APPLICATIONS_DIR = tempDir("runs-apps-");
});
afterEach(() => {
  if (savedApps === undefined) delete process.env.JOBAGENT_APPLICATIONS_DIR;
  else process.env.JOBAGENT_APPLICATIONS_DIR = savedApps;
  if (savedSeed === undefined) delete process.env.OPENSIDEBAR_SEED_DIR;
  else process.env.OPENSIDEBAR_SEED_DIR = savedSeed;
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A ready-to-fill application with kit. */
function seedReadyApp(name = "acme-ai-engineer", status = "ready"): string {
  const dir = join(process.env.JOBAGENT_APPLICATIONS_DIR!, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "application-package.json"),
    JSON.stringify({
      schemaVersion: 1, company: "Acme", roleTitle: "AI Engineer",
      sourceUrl: "https://board.example/jobs/1", status,
    }),
    "utf8",
  );
  writeFileSync(
    join(dir, "run-config.json"),
    JSON.stringify({
      formUrl: "https://board.example/apply/1",
      promptLines: ["Fill the form.", 'Field "Email": sam@example.test'],
      expectedFieldValues: ["sam@example.test"],
    }),
    "utf8",
  );
  return dir;
}

interface FakeWorld {
  manager: RunManager;
  bridgeCalls: Array<{ tool: string; args: Record<string, unknown>; session?: string }>;
  events: ConsoleEvent[];
  runLogs: Map<string, string[]>;
  bridgeClosed: () => number;
  bridgesCreated: () => number;
  finishPi: (code: number) => void;
  piSpawned: () => number;
  scriptedResponses: Array<unknown>;
}

function makeWorld(now = 1_000_000, opts: { traceSinkUp?: boolean } = {}): FakeWorld {
  const bridgeCalls: FakeWorld["bridgeCalls"] = [];
  const events: ConsoleEvent[] = [];
  const runLogs = new Map<string, string[]>();
  const scriptedResponses: unknown[] = [];
  let closed = 0;
  let created = 0;
  let spawned = 0;
  let piExit: ((code: number | null) => void) | null = null;
  let clock = now;

  const bridge: ConsoleBridge = {
    get connected() { return true; },
    async call(request) {
      bridgeCalls.push(request);
      const next = scriptedResponses.shift();
      if (next === undefined) return { status: "ok", result: "done" };
      return next as any;
    },
    async close() { closed++; },
  };

  const deps: RunManagerDeps = {
    createBridge: async () => { created++; return bridge; },
    spawnPi: (): PiProcess => {
      spawned++;
      const lineCbs: Array<(l: string) => void> = [];
      const exitCbs: Array<(c: number | null) => void> = [];
      piExit = (code) => exitCbs.forEach((cb) => cb(code));
      setTimeout(() => lineCbs.forEach((cb) => cb("pi says hello")), 0);
      return {
        onLine: (cb) => lineCbs.push(cb),
        onExit: (cb) => exitCbs.push(cb),
        kill: () => piExit?.(-1),
      };
    },
    startCvServer: async () => ({ url: "http://127.0.0.1:0/cv.pdf", close: async () => {} }),
    now: () => clock++,
    emit: (event) => events.push(event),
    appendAudit: () => {},
    // Default "up" so existing tests see no trace-sink warning line.
    probeTraceServer: async () => opts.traceSinkUp ?? true,
    appendRunLog: (runId, line) => {
      const lines = runLogs.get(runId) ?? [];
      lines.push(line);
      runLogs.set(runId, lines);
    },
  };

  const manager = new RunManager(deps);
  return {
    manager,
    bridgeCalls,
    events,
    runLogs,
    bridgeClosed: () => closed,
    bridgesCreated: () => created,
    finishPi: (code) => piExit?.(code),
    piSpawned: () => spawned,
    scriptedResponses,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

function readStatus(name: string): string {
  return JSON.parse(
    readFileSync(
      join(process.env.JOBAGENT_APPLICATIONS_DIR!, name, "application-package.json"),
      "utf8",
    ),
  ).status;
}

describe("fill runs", () => {
  test("happy path: ok outcome advances ready → filled-awaiting-submit", async () => {
    seedReadyApp();
    const world = makeWorld();
    await world.manager.start();

    const started = world.manager.startFill("acme-ai-engineer", "fill");
    expect(started.status).toBe(200);
    await flush();

    expect(world.bridgeCalls[0].tool).toBe("browser_run_task");
    expect(String(world.bridgeCalls[0].args.instruction)).toContain("sam@example.test");
    // The form url must ride along: it is what opens the tab on the form.
    // Omitting it stranded a live run on about:blank until the bridge timed
    // out 10 minutes later.
    expect(world.bridgeCalls[0].args.url).toBe("https://board.example/apply/1");
    expect(world.bridgeCalls[0].session).toContain("console-");
    expect(readStatus("acme-ai-engineer")).toBe("filled-awaiting-submit");
    expect(world.manager.listRuns()[0].state).toBe("ok");
  });

  // A live fill dies with the browser it drives. Both halves of the durable
  // record are covered here: the console log must be written line-by-line as
  // the run proceeds, and a missing agent-trace sink must be stated rather
  // than left silent (trace.ts logs flush failures at debug level only, so an
  // untraced run is otherwise indistinguishable from a traced one).
  test("run log is persisted line-by-line, not at finish", async () => {
    seedReadyApp();
    const world = makeWorld();
    await world.manager.start();

    world.manager.startFill("acme-ai-engineer", "fill");
    await flush();

    const runId = world.manager.listRuns()[0].id;
    const lines = world.runLogs.get(runId) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("starting fill mission"))).toBe(true);
  });

  test("a missing trace sink is recorded and warned about, and does not block the run", async () => {
    seedReadyApp();
    const world = makeWorld(1_000_000, { traceSinkUp: false });
    await world.manager.start();

    world.manager.startFill("acme-ai-engineer", "fill");
    await flush();

    const run = world.manager.listRuns()[0];
    expect(run.traceServer).toBe("down");
    const lines = world.runLogs.get(run.id) ?? [];
    expect(lines.some((l) => l.includes("7589"))).toBe(true);
    // Warned, not blocked: the fill still completes.
    expect(run.state).toBe("ok");
    expect(readStatus("acme-ai-engineer")).toBe("filled-awaiting-submit");
  });

  test("a reachable trace sink is recorded without a warning line", async () => {
    seedReadyApp();
    const world = makeWorld();
    await world.manager.start();

    world.manager.startFill("acme-ai-engineer", "fill");
    await flush();

    const run = world.manager.listRuns()[0];
    expect(run.traceServer).toBe("up");
    expect((world.runLogs.get(run.id) ?? []).some((l) => l.includes("7589"))).toBe(false);
  });

  test("wrong status is refused up front", async () => {
    seedReadyApp("acme-ai-engineer", "reviewing");
    const world = makeWorld();
    await world.manager.start();
    const refused = world.manager.startFill("acme-ai-engineer", "fill");
    expect(refused.status).toBe(409);
    expect((refused.body as any).error).toContain('needs status "ready"');
  });

  test("approval round trip: pause → approve → respond_approval → submitted-by-user", async () => {
    seedReadyApp("acme-ai-engineer", "filled-awaiting-submit");
    const world = makeWorld();
    await world.manager.start();

    const approval = {
      approvalId: "appr-1", toolName: "click_element", args: { id: 9 },
      context: "Submit the application form",
      requestedAt: 1_000_000, timeoutMs: 600_000, expiresAt: 2_000_000,
      dryRun: { kind: "clean", formKey: "f", diffHash: "h", entries: [] },
    };
    world.scriptedResponses.push(
      { status: "needs_human", approval },
      { status: "ok", result: "Application submitted." },
    );

    world.manager.startFill("acme-ai-engineer", "submit");
    await flush();

    // Approval is pending; the run waits.
    expect(world.manager.listApprovals().pending).toHaveLength(1);
    expect(world.manager.listRuns()[0].state).toBe("awaiting-approval");
    expect(world.events.some((e) => e.type === "approval-pending")).toBe(true);

    // Human approves in the UI.
    const resolved = world.manager.resolveApproval("appr-1", true);
    expect(resolved.status).toBe(200);
    await flush();

    const respond = world.bridgeCalls.find((c) => c.tool === "browser_respond_approval");
    expect(respond).toBeDefined();
    expect(respond!.args).toEqual({ approvalId: "appr-1", approved: true });
    expect(respond!.session).toBe(world.bridgeCalls[0].session); // same session
    expect(readStatus("acme-ai-engineer")).toBe("submitted-by-user");
    expect(world.manager.listRuns()[0].state).toBe("ok");
  });

  test("deny path: respond with approved=false, no status change", async () => {
    seedReadyApp("acme-ai-engineer", "filled-awaiting-submit");
    const world = makeWorld();
    await world.manager.start();
    world.scriptedResponses.push(
      {
        status: "needs_human",
        approval: {
          approvalId: "appr-2", toolName: "click_element", args: {},
          context: "Submit", requestedAt: 1_000_000, timeoutMs: 600_000, expiresAt: 2_000_000,
        },
      },
      { status: "needs_human", reason: "action refused" },
    );
    world.manager.startFill("acme-ai-engineer", "submit");
    await flush();
    world.manager.resolveApproval("appr-2", false);
    await flush();

    expect(readStatus("acme-ai-engineer")).toBe("filled-awaiting-submit");
    expect(world.manager.listRuns()[0].state).toBe("denied");
  });

  test("chained pauses are all surfaced and answered", async () => {
    seedReadyApp("acme-ai-engineer", "filled-awaiting-submit");
    const world = makeWorld();
    await world.manager.start();
    const mkApproval = (id: string): unknown => ({
      status: "needs_human",
      approval: {
        approvalId: id, toolName: "click_element", args: {},
        context: `gate ${id}`, requestedAt: 1_000_000, timeoutMs: 600_000, expiresAt: 2_000_000,
      },
    });
    world.scriptedResponses.push(mkApproval("a1"), mkApproval("a2"), { status: "ok", result: "done" });
    world.manager.startFill("acme-ai-engineer", "submit");
    await flush();
    world.manager.resolveApproval("a1", true);
    await flush();
    world.manager.resolveApproval("a2", true);
    await flush();

    const responds = world.bridgeCalls.filter((c) => c.tool === "browser_respond_approval");
    expect(responds.map((r) => r.args.approvalId)).toEqual(["a1", "a2"]);
    expect(world.manager.listRuns()[0].state).toBe("ok");
  });

  test("expiry: run ends 'expired', package untouched, re-runnable", async () => {
    vi.useFakeTimers();
    try {
      seedReadyApp("acme-ai-engineer", "filled-awaiting-submit");
      const world = makeWorld();
      await world.manager.start();
      world.scriptedResponses.push({
        status: "needs_human",
        approval: {
          approvalId: "appr-3", toolName: "click_element", args: {},
          context: "Submit", requestedAt: 1_000_000, timeoutMs: 50, expiresAt: 1_000_050,
        },
      });
      world.manager.startFill("acme-ai-engineer", "submit");
      await vi.advanceTimersByTimeAsync(30);
      expect(world.manager.listRuns()[0].state).toBe("awaiting-approval");
      await vi.advanceTimersByTimeAsync(600);

      expect(world.manager.listRuns()[0].state).toBe("expired");
      expect(readStatus("acme-ai-engineer")).toBe("filled-awaiting-submit");
      // A late human click gets a clean 410.
      expect(world.manager.resolveApproval("appr-3", true).status).toBe(410);
      // Re-runnable: same package can start a new submit run.
      expect(world.manager.startFill("acme-ai-engineer", "submit").status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  test("only one run at a time", async () => {
    seedReadyApp();
    const world = makeWorld();
    await world.manager.start();
    world.scriptedResponses.push(new Promise(() => {}) as any); // never resolves
    world.manager.startFill("acme-ai-engineer", "fill");
    await flush();
    expect(world.manager.startDiscovery().status).toBe(409);
    expect(world.manager.startFill("acme-ai-engineer", "fill").status).toBe(409);
  });
});

describe("discovery runs + bridge ownership", () => {
  test("bridge closes before pi spawns and is recreated after exit", async () => {
    const world = makeWorld();
    await world.manager.start();
    expect(world.bridgesCreated()).toBe(1);

    world.manager.startDiscovery();
    await flush();
    expect(world.bridgeClosed()).toBe(1); // released before spawn
    expect(world.piSpawned()).toBe(1);
    expect(world.manager.bridgeStatus().owner).toBe("pi-run");
    expect(world.manager.listRuns()[0].log).toContain("pi says hello");

    world.finishPi(0);
    await flush();
    expect(world.bridgesCreated()).toBe(2); // reacquired
    expect(world.manager.bridgeStatus().owner).toBe("console");
    expect(world.manager.listRuns()[0].state).toBe("ok");
  });

  test("nonzero pi exit marks the run failed", async () => {
    const world = makeWorld();
    await world.manager.start();
    world.manager.startDiscovery();
    await flush();
    world.finishPi(3);
    await flush();
    expect(world.manager.listRuns()[0].state).toBe("failed");
    expect(world.manager.listRuns()[0].outcomeSummary).toContain("code 3");
  });

  test("cancel kills pi and finishes the run canceled", async () => {
    const world = makeWorld();
    await world.manager.start();
    const { body } = world.manager.startDiscovery() as { body: { runId: string } };
    await flush();
    expect(world.manager.cancelRun(body.runId)).toBe(true);
    await flush();
    expect(world.manager.listRuns()[0].state).toBe("canceled");
  });
});
