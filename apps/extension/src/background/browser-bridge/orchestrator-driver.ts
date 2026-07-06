/**
 * Production AgentRunner over the orchestrator (RFC LP-8, M2 Stage 2b).
 *
 * Runs an OpenClaw-driven thick-tool intent as a real orchestrator task:
 * opens a fresh background tab (so it never hijacks the user's active tab),
 * starts the task with a unique `workspaceId`, and resolves when the matching
 * `TASK_COMPLETION` arrives (correlated by that workspaceId — no orchestrator API
 * change needed). The orchestrator/chrome coupling is injected via
 * `BrowserTaskDeps` so the logic is unit-tested; `createDefaultBrowserTaskDeps`
 * wires the real singletons.
 */

import type { UserSettings } from "../../types";
import { chromeRuntimeEnvironment } from "../environment/chrome";
import { loadApiKey, loadSettings } from "../../utils/settings-storage";
import { createAgentRuntime } from "../runtime";

// OpenClaw drives the shared agent runtime — the same library API the sidepanel
// uses — instead of importing the orchestrator directly (RFC LP-15, Phase 5).
const browserRuntime = createAgentRuntime(chromeRuntimeEnvironment);
import type { AgentRunOutcome, AgentRunner, AgentTask } from "./handler";

export interface CompletionPayload {
  status?: string;
  summary?: string;
}

export interface BrowserTaskDeps {
  /** Open a background tab and return its id. */
  createTab(url: string): Promise<number>;
  /** Start an orchestrator task in the given tab/workspace. */
  startTask(input: { query: string; tabId: number; workspaceId: string }): Promise<void>;
  /** Subscribe to task completions; returns an unsubscribe fn. */
  addCompletionListener(
    fn: (workspaceId: string, payload: CompletionPayload) => void,
  ): () => void;
}

function newWorkspaceId(): string {
  return `openclaw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function mapCompletion(payload: CompletionPayload): AgentRunOutcome {
  if (payload.status === "completed") {
    return { status: "completed", summary: payload.summary };
  }
  return {
    status: "error",
    reason: payload.summary ?? `task ${payload.status ?? "ended"}`,
  };
}

/** AgentRunner that drives the orchestrator. Deps injected for testability. */
export function createBrowserAgentRunner(deps: BrowserTaskDeps): AgentRunner {
  return {
    run(task: AgentTask): Promise<AgentRunOutcome> {
      const workspaceId = newWorkspaceId();
      return new Promise<AgentRunOutcome>((resolve) => {
        let settled = false;
        const finish = (outcome: AgentRunOutcome) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          resolve(outcome);
        };
        const unsubscribe = deps.addCompletionListener((ws, payload) => {
          if (ws === workspaceId) finish(mapCompletion(payload));
        });
        deps
          .createTab(task.url ?? "about:blank")
          .then((tabId) => deps.startTask({ query: task.instruction, tabId, workspaceId }))
          .catch((error) => finish({ status: "error", reason: (error as Error).message }));
      });
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
