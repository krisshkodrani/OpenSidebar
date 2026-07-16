/**
 * Production AgentRunner over the orchestrator (RFC LP-8, M2 Stage 2b; sessions
 * + cancellation in pi-backend Phase 3).
 *
 * Runs an external caller's thick-tool intent as a real orchestrator task in a
 * background tab (never hijacking the user's active tab), and resolves when the
 * matching `TASK_COMPLETION` arrives (correlated by `workspaceId`).
 *
 * Sessions: calls carrying the same `task.session` share one workspace and one
 * tab, so Mission B lands on the page Mission A left open — that continuity is
 * what the mission/report protocol depends on (e.g. verify-then-submit). Runs
 * on a session are SERIALIZED: the orchestrator's same-workspace replacement
 * stops-then-starts without awaiting the stop drain, so starting a follow-up
 * before the prior completion arrives corrupts its task registration. Session
 * tabs are deliberately never closed (the user may be reading them; the next
 * mission needs them); the registry is in-memory — a SW restart just means the
 * next call gets a fresh workspace + tab. Sessionless calls behave as always:
 * fresh workspace + fresh tab per call.
 *
 * Cancellation: an aborted signal asks the orchestrator to stop the workspace;
 * the run still settles via its completion (bounded by the run timeout), which
 * is what keeps the session queue safe.
 *
 * The orchestrator/chrome coupling is injected via `BrowserTaskDeps` so the
 * logic is unit-tested; `createDefaultBrowserTaskDeps` wires the real
 * singletons.
 */

import type { UserSettings } from "../../types";
import { chromeRuntimeEnvironment } from "../environment/chrome";
import { loadApiKey, loadSettings } from "../../utils/settings-storage";
import { createAgentRuntime, type TaskCompletionPayload } from "../runtime";
import type { AgentRunOptions, AgentRunOutcome, AgentRunner, AgentTask } from "./handler";

// The bridge drives the shared agent runtime — the same library API the
// sidepanel uses — instead of importing the orchestrator directly (RFC LP-15,
// Phase 5).
const browserRuntime = createAgentRuntime(chromeRuntimeEnvironment);

/**
 * A TASK_COMPLETION payload as observed off the messaging port. `Partial`
 * because the port yields `unknown` — nothing guarantees a well-formed payload.
 */
export type CompletionPayload = Partial<TaskCompletionPayload>;

/** No completion within this window resolves the run rather than hanging. */
const DEFAULT_RUN_TIMEOUT_MS = 600_000;

/**
 * Mirrors the host-side `BROWSER_TOOL_CANCELED_REASON` in
 * `scripts/browser-mcp/bridge.ts` (which cannot live in shared-types as a
 * value — that module must stay type-only for the pi loader). Cosmetic only;
 * nothing matches on it.
 */
const CANCELED_REASON = "canceled by caller";

export interface BrowserTaskDeps {
  /** Open a background tab and return its id. */
  createTab(url: string): Promise<number>;
  /** True if the tab is still open (the user can close session tabs anytime). */
  tabExists(tabId: number): Promise<boolean>;
  /** Point an existing tab at a url. Does not await page load (nor does createTab). */
  navigateTab(tabId: number, url: string): Promise<void>;
  /** Start an orchestrator task in the given tab/workspace. */
  startTask(input: { query: string; tabId: number; workspaceId: string }): Promise<void>;
  /** Ask the orchestrator to stop the workspace's running task. */
  stopTask(workspaceId: string): Promise<void>;
  /** Subscribe to task completions; returns an unsubscribe fn. */
  addCompletionListener(
    fn: (workspaceId: string, payload: CompletionPayload) => void,
  ): () => void;
  /** Overridable for tests. */
  timeoutMs?: number;
}

function newWorkspaceId(): string {
  return `bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Map a task completion to a bridge outcome.
 *
 * A `partial` run is NOT a failure: the agent did work and produced a
 * `partialHandoff` describing what is done, what remains, and what it is unsure
 * about. Collapsing that into `{status: "error"}` — as this did — threw away the
 * only artifact a caller can use to continue, and mislabelled progress as
 * breakage. It maps to `needs_human`, which the wire contract defines as
 * "paused, may resume — NOT an error".
 */
export function mapCompletion(payload: CompletionPayload): AgentRunOutcome {
  const handoff = payload.partialHandoff;
  switch (payload.status) {
    case "completed":
      return { status: "completed", summary: payload.summary, handoff };
    case "partial":
      return {
        status: "needs_human",
        summary: payload.summary,
        handoff,
        reason:
          handoff?.uncertainty?.[0]?.text ??
          payload.summary ??
          payload.terminationReason ??
          "run ended with work outstanding",
      };
    default:
      return {
        status: "error",
        summary: payload.summary,
        handoff,
        reason:
          payload.terminationReason ??
          payload.summary ??
          `task ${payload.status ?? "ended"}`,
      };
  }
}

interface SessionEntry {
  workspaceId: string;
  tabId: number | null;
  /**
   * Serializes runs on the session. The orchestrator's same-workspace
   * replacement does not await the old task's stop drain, so a follow-up
   * started mid-drain gets its registration deleted and its completion
   * listener fed the old task's "stopped" broadcast. Nothing starts until the
   * prior run's completion has arrived.
   */
  queue: Promise<unknown>;
}

/** AgentRunner that drives the orchestrator. Deps injected for testability. */
export function createBrowserAgentRunner(deps: BrowserTaskDeps): AgentRunner {
  // One caller process = one session id, so this map is effectively a
  // singleton per external client; no eviction needed.
  const sessions = new Map<string, SessionEntry>();

  async function resolveTab(task: AgentTask, entry: SessionEntry | null): Promise<number> {
    if (entry?.tabId != null && (await deps.tabExists(entry.tabId))) {
      if (task.url) await deps.navigateTab(entry.tabId, task.url);
      return entry.tabId;
    }
    const tabId = await deps.createTab(task.url ?? "about:blank");
    if (entry) entry.tabId = tabId;
    return tabId;
  }

  function executeRun(
    task: AgentTask,
    entry: SessionEntry | null,
    signal: AbortSignal | undefined,
  ): Promise<AgentRunOutcome> {
    if (signal?.aborted) {
      // Aborted while queued (or before dispatch): touch nothing.
      return Promise.resolve({ status: "error", reason: CANCELED_REASON });
    }
    const workspaceId = entry?.workspaceId ?? newWorkspaceId();
    return new Promise<AgentRunOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: AgentRunOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = () => {
        // Ask the orchestrator to stop; the run settles via the stopped
        // completion (not early), which keeps the session queue blocked until
        // the drain lands.
        void deps.stopTask(workspaceId).catch(() => {});
      };
      // Without this the promise hangs forever whenever a completion is lost,
      // and the caller only ever learns via its own transport timeout.
      const timer = setTimeout(() => {
        finish({
          status: "error",
          reason: `no task completion within ${deps.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS}ms`,
        });
      }, deps.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
      const unsubscribe = deps.addCompletionListener((ws, payload) => {
        if (ws === workspaceId) finish(mapCompletion(payload));
      });
      signal?.addEventListener("abort", onAbort);
      resolveTab(task, entry)
        .then(async (tabId) => {
          await deps.startTask({ query: task.instruction, tabId, workspaceId });
          // An abort that landed while startTask was in flight found nothing
          // to stop — re-issue now that the task is registered.
          if (signal?.aborted) onAbort();
        })
        .catch((error) => finish({ status: "error", reason: (error as Error).message }));
    });
  }

  return {
    run(task: AgentTask, opts?: AgentRunOptions): Promise<AgentRunOutcome> {
      const signal = opts?.signal;
      if (!task.session) return executeRun(task, null, signal);
      let entry = sessions.get(task.session);
      if (!entry) {
        entry = { workspaceId: newWorkspaceId(), tabId: null, queue: Promise.resolve() };
        sessions.set(task.session, entry);
      }
      const sessionEntry = entry;
      const run = sessionEntry.queue.then(() => executeRun(task, sessionEntry, signal));
      // executeRun never rejects by design, but guard the queue anyway so one
      // bad run can never wedge the session forever.
      sessionEntry.queue = run.catch(() => {});
      return run;
    },
  };
}

/** Wire the real chrome + orchestrator + settings singletons (RFC LP-8, M2). */
export function createDefaultBrowserTaskDeps(): BrowserTaskDeps {
  return {
    async createTab(url) {
      const tab = await chrome.tabs.create({ url, active: false });
      if (typeof tab.id !== "number") throw new Error("Failed to open a tab.");
      return tab.id;
    },
    async tabExists(tabId) {
      try {
        await chrome.tabs.get(tabId);
        return true;
      } catch {
        return false;
      }
    },
    async navigateTab(tabId, url) {
      await chrome.tabs.update(tabId, { url });
    },
    async stopTask(workspaceId) {
      await browserRuntime.stopTask(workspaceId);
    },
    async startTask({ query, tabId, workspaceId }) {
      const settings = (await loadSettings()) ?? ({} as UserSettings);
      const apiKey = await loadApiKey();
      await browserRuntime.startTask({
        query,
        tabId,
        workspaceId,
        settings,
        openRouterApiKey: apiKey || settings.openRouterApiKey || "",
      });
    },
    addCompletionListener(fn) {
      // Completions correlate by workspaceId over the runtime's messaging seam
      // (RFC LP-15, Phase 5).
      return browserRuntime.onTaskCompletion(fn);
    },
  };
}

/** Start the browser bridge: connect to the host and serve thick tools. */
export function createDefaultBrowserAgentRunner(): AgentRunner {
  return createBrowserAgentRunner(createDefaultBrowserTaskDeps());
}
