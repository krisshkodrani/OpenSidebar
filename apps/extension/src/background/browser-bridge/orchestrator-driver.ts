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
 * Approvals (pi-backend Phase 4): a consequential action (e.g. a form submit)
 * pauses the run for approval. Bridge missions have no sidepanel, so the pause
 * arrives as a TASK_PAUSED and the run settles `needs_human` carrying the
 * approval question + Phase 8 dry-run evidence. The mission stays ALIVE and
 * checkpointed; the caller answers with `browser_respond_approval`
 * (→ `respondApproval`), which resumes the paused task and awaits its next
 * outcome. The answer joins the session queue so a queued mission cannot start
 * mid-resume (starting one would stop the paused task).
 *
 * The orchestrator/chrome coupling is injected via `BrowserTaskDeps` so the
 * logic is unit-tested; `createDefaultBrowserTaskDeps` wires the real
 * singletons.
 */

import type { BrowserToolRequest } from "@shared-types/browser-bridge";
import type {
  RemoteMissionTargetBindingV1,
  RemoteMissionTargetSelectionV1,
} from "@shared-types/remote-missions";

import type { UserSettings } from "../../types";
import { chromeRuntimeEnvironment } from "../environment/chrome";
import { loadApiKey, loadSettings } from "../../utils/settings-storage";
import { getProviderKeyStatus } from "../../utils/provider-keys";
import { getBlockedRuleForUrl } from "../../utils/site-access";
import { ensureContentScript } from "../infrastructure/tab-ready";
import { verifyIsolatedTaskWorkspace } from "./isolated-workspace";
import { createWorkspaceTab } from "../workspaces/create-workspace-tab";
import { workspaceManager } from "../workspaces/manager";
import {
  createAgentRuntime,
  type TaskCompletionPayload,
  type TaskPausedPayload,
} from "../runtime";
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

class TargetSelectionRequiredError extends Error {
  constructor(readonly selection: RemoteMissionTargetSelectionV1) {
    super("target_selection_required");
  }
}

export function resolveBrowserAgentCredential(
  settings: UserSettings,
  locallyLoadedKey: string,
) {
  const provider = getProviderKeyStatus(settings);
  if (!provider.hasRequiredKeys || !provider.activeKey)
    throw new Error(
      `API key is missing for ${provider.mode}. Please configure it in settings.`,
    );
  return provider.activeKey || locallyLoadedKey || settings.openRouterApiKey || "";
}

/** A TASK_PAUSED payload (approval awaiting an answer) off the messaging port. */
export type PausePayload = TaskPausedPayload;

export interface BrowserTaskDeps {
  /** Open a background tab and return its id. */
  createTab(url: string): Promise<number>;
  /** Return the active tab in the current window for explicitly visible runs. */
  getActiveTab?(): Promise<number>;
  /** Find already-open exact URL matches without exposing Chrome identifiers. */
  findTabsByUrl?(url: string): Promise<Array<{
    tabId: number;
    pageTitle: string;
    groupTitle?: string;
    windowLabel?: string;
  }>>;
  /** List existing real OpenSidebar workspaces, one bounded candidate each. */
  findWorkspaceTargets?(): Promise<Array<{
    workspaceId: string;
    sourceTabId: number;
    pageTitle: string;
    groupTitle?: string;
    windowLabel?: string;
  }>>;
  /** Create a background tab directly inside an existing workspace. */
  createTabInWorkspace?(sourceTabId: number, workspaceId: string, url: string): Promise<number>;
  /** True if the tab is still open (the user can close session tabs anytime). */
  tabExists(tabId: number): Promise<boolean>;
  /** Revalidate that an opaque choice still points at the expected exact URL. */
  tabMatchesUrl?(tabId: number, expectedUrl: string): Promise<boolean>;
  /** Point an existing tab at a url. Does not await page load (nor does createTab). */
  navigateTab(tabId: number, url: string): Promise<void>;
  /** Wait until the production content bridge can observe the selected tab. */
  ensureTabReady?(tabId: number): Promise<void>;
  /** Prove workspace/group/panel binding and return sanitized evidence. */
  verifyIsolatedWorkspace(
    tabId: number,
    expectedUrl: string | undefined,
    createdForMission: boolean,
  ): Promise<RemoteMissionTargetBindingV1>;
  /** Inspect a visible/existing target without changing its workspace state. */
  describeTarget?(
    tabId: number,
    context: "active_tab" | "existing_tab",
    expectedUrl?: string,
  ): Promise<RemoteMissionTargetBindingV1>;
  /** Start an orchestrator task in the given tab/workspace. */
  startTask(input: {
    query: string;
    tabId: number;
    workspaceId: string;
    executionToolProfile?: AgentTask["executionToolProfile"];
  }): Promise<void>;
  /** Ask the orchestrator to stop the workspace's running task. */
  stopTask(workspaceId: string): Promise<void>;
  /** Answer a forwarded approval; false if no matching pending approval exists. */
  resolveApproval(
    workspaceId: string,
    payload: { approvalId: string; approved: boolean },
  ): boolean;
  /** Re-check the current device's latest site policy before remote approval. */
  validateApprovalContext?(tabId: number): Promise<boolean>;
  /** Subscribe to task completions; returns an unsubscribe fn. */
  addCompletionListener(
    fn: (workspaceId: string, payload: CompletionPayload) => void,
  ): () => void;
  /** Subscribe to task pauses (approvals awaiting an answer); returns unsubscribe. */
  addPauseListener(
    fn: (workspaceId: string, payload: PausePayload) => void,
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
  /** Real visual workspace selected for an isolated mission. */
  visualWorkspaceId?: string;
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

type ResolvedTarget = {
  tabId: number;
  createdForMission: boolean;
  visualWorkspaceId?: string;
};

type TargetChoice =
  | {
      kind: "existing_tab";
      session: string;
      tabId: number;
      expectedUrl: string;
      expiresAt: number;
    }
  | {
      kind: "workspace";
      session: string;
      workspaceId: string;
      sourceTabId: number;
      expiresAt: number;
    };

/** Project a forwarded pause into a `needs_human` outcome carrying the approval. */
function pauseToOutcome(payload: PausePayload): AgentRunOutcome {
  const i = payload.interaction;
  return {
    status: "needs_human",
    reason: `approval required: ${i.context}`,
    approval: {
      approvalId: i.approvalId,
      toolName: i.toolName,
      args: i.args,
      context: i.context,
      requestedAt: i.requestedAt,
      timeoutMs: i.timeoutMs,
      expiresAt: i.expiresAt,
      ...(i.dryRun ? { dryRun: i.dryRun } : {}),
    },
  };
}

/** AgentRunner that drives the orchestrator. Deps injected for testability. */
export function createBrowserAgentRunner(deps: BrowserTaskDeps): AgentRunner {
  // One caller process = one session id, so this map is effectively a
  // singleton per external client; no eviction needed.
  const sessions = new Map<string, SessionEntry>();
  const workspaceTabs = new Map<string, number>();
  const workspaceTargets = new Map<string, RemoteMissionTargetBindingV1>();
  // Remember which workspace a forwarded approval belongs to, so a sessionless
  // (or SW-restart) respond call can still target it. Never cleared — bounded
  // by the number of approvals a single caller process produces.
  const approvalWorkspaces = new Map<string, string>();
  const targetChoices = new Map<string, TargetChoice>();

  async function resolveTab(
    task: AgentTask,
    entry: SessionEntry | null,
    onProgress?: AgentRunOptions["onProgress"],
  ): Promise<ResolvedTarget> {
    if (task.targetContext === "existing_tab") {
      if (!task.url)
        throw new Error("An existing-tab remote task requires a target URL.");
      if (task.targetHandle) {
        const choice = targetChoices.get(task.targetHandle);
        if (
          !choice ||
          choice.kind !== "existing_tab" ||
          !task.session ||
          choice.session !== task.session ||
          choice.expiresAt <= Date.now() ||
          !(await deps.tabExists(choice.tabId)) ||
          !deps.tabMatchesUrl ||
          !(await deps.tabMatchesUrl(choice.tabId, choice.expectedUrl))
        ) throw new Error("The selected browser target expired or is no longer open.");
        for (const [handle, candidate] of targetChoices)
          if (candidate.session === task.session) targetChoices.delete(handle);
        if (entry) entry.tabId = choice.tabId;
        return { tabId: choice.tabId, createdForMission: false };
      }
      const matches = await deps.findTabsByUrl?.(task.url) ?? [];
      for (const [handle, candidate] of targetChoices)
        if (candidate.expiresAt <= Date.now()) targetChoices.delete(handle);
      if (!matches.length)
        throw new Error("The requested existing browser tab is not open.");
      if (matches.length > 1) {
        if (!task.session)
          throw new Error("Ambiguous browser targets require a mission session.");
        const expiresAt = Date.now() + 5 * 60_000;
        const candidates = matches.slice(0, 10).map((match) => {
          const targetHandle = `target_${crypto.randomUUID()}`;
          targetChoices.set(targetHandle, {
            kind: "existing_tab",
            session: task.session!,
            tabId: match.tabId,
            expectedUrl: new URL(task.url!).href,
            expiresAt,
          });
          return {
            targetHandle,
            pageTitle: match.pageTitle.slice(0, 160),
            ...(match.groupTitle ? { groupTitle: match.groupTitle.slice(0, 80) } : {}),
            ...(match.windowLabel ? { windowLabel: match.windowLabel.slice(0, 80) } : {}),
          };
        });
        throw new TargetSelectionRequiredError({
          expiresAt: new Date(expiresAt).toISOString(),
          candidates,
        });
      }
      const tabId = matches[0]!.tabId;
      if (entry) entry.tabId = tabId;
      return { tabId, createdForMission: false };
    }
    if (task.targetContext === "active_tab") {
      const tabId = await deps.getActiveTab?.();
      if (typeof tabId !== "number")
        throw new Error("No active browser tab is available for the remote task.");
      if (task.url) await deps.navigateTab(tabId, task.url);
      if (entry) entry.tabId = tabId;
      return { tabId, createdForMission: false };
    }
    if (entry?.tabId != null && (await deps.tabExists(entry.tabId))) {
      if (task.url) await deps.navigateTab(entry.tabId, task.url);
      return {
        tabId: entry.tabId,
        createdForMission: false,
        ...(entry.visualWorkspaceId
          ? { visualWorkspaceId: entry.visualWorkspaceId }
          : {}),
      };
    }
    if (!deps.findWorkspaceTargets || !deps.createTabInWorkspace) {
      throw new Error("Existing OpenSidebar workspace discovery is unavailable.");
    }
    let target: { sourceTabId: number; workspaceId: string };
    if (task.targetHandle) {
      const choice = targetChoices.get(task.targetHandle);
      if (
        !choice ||
        choice.kind !== "workspace" ||
        !task.session ||
        choice.session !== task.session ||
        choice.expiresAt <= Date.now() ||
        !(await deps.tabExists(choice.sourceTabId))
      ) throw new Error("The selected OpenSidebar workspace expired or is no longer open.");
      target = choice;
      for (const [handle, candidate] of targetChoices)
        if (candidate.session === task.session) targetChoices.delete(handle);
    } else {
      await onProgress?.("Discovering the existing OpenSidebar workspace.");
      const matches = await deps.findWorkspaceTargets();
      if (!matches.length) {
        throw new Error(
          "No existing OpenSidebar workspace is available. Open a workspace before starting isolated remote work.",
        );
      }
      if (matches.length > 1) {
        if (!task.session)
          throw new Error("Ambiguous OpenSidebar workspaces require a mission session.");
        const expiresAt = Date.now() + 5 * 60_000;
        const candidates = matches.slice(0, 10).map((match) => {
          const targetHandle = `target_${crypto.randomUUID()}`;
          targetChoices.set(targetHandle, {
            kind: "workspace",
            session: task.session!,
            workspaceId: match.workspaceId,
            sourceTabId: match.sourceTabId,
            expiresAt,
          });
          return {
            targetHandle,
            pageTitle: match.pageTitle.slice(0, 160),
            ...(match.groupTitle ? { groupTitle: match.groupTitle.slice(0, 80) } : {}),
            ...(match.windowLabel ? { windowLabel: match.windowLabel.slice(0, 80) } : {}),
          };
        });
        throw new TargetSelectionRequiredError({
          expiresAt: new Date(expiresAt).toISOString(),
          candidates,
        });
      }
      target = matches[0]!;
    }
    await onProgress?.("Creating the mission tab in the selected workspace.");
    const tabId = await deps.createTabInWorkspace(
      target.sourceTabId,
      target.workspaceId,
      task.url ?? "about:blank",
    );
    if (entry) {
      entry.tabId = tabId;
      entry.visualWorkspaceId = target.workspaceId;
      entry.workspaceId = target.workspaceId;
    }
    return {
      tabId,
      createdForMission: true,
      visualWorkspaceId: target.workspaceId,
    };
  }

  /**
   * Arm the completion + pause listeners for a workspace, run `start`, and
   * resolve with the first of: a completion (mapped), a pause (needs_human +
   * approval), an abort (asks the orchestrator to stop, settles via the
   * stopped completion), a start error, or the run timeout. Shared by a fresh
   * run and an approval resume — both await "the workspace's next outcome".
   */
  function waitForOutcome(
    workspaceId: string,
    signal: AbortSignal | undefined,
    start: () => Promise<void>,
    finalizeTarget?: () => Promise<RemoteMissionTargetBindingV1>,
  ): Promise<AgentRunOutcome> {
    return new Promise<AgentRunOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: AgentRunOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        offCompletion();
        offPause();
        signal?.removeEventListener("abort", onAbort);
        void (async () => {
          try {
            const target = finalizeTarget
              ? await finalizeTarget()
              : workspaceTargets.get(workspaceId);
            if (target) workspaceTargets.set(workspaceId, target);
            resolve(target ? { ...outcome, target } : outcome);
          } catch (error) {
            resolve({
              status: "error",
              reason: `Remote target binding was lost before completion: ${(error as Error).message}`,
            });
          }
        })();
      };
      const onAbort = () => {
        // Settle via the stopped completion (not early), which keeps the
        // session queue blocked until the drain lands.
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
      const offCompletion = deps.addCompletionListener((ws, payload) => {
        if (ws === workspaceId) finish(mapCompletion(payload));
      });
      const offPause = deps.addPauseListener((ws, payload) => {
        if (ws !== workspaceId) return;
        if (payload.interaction.kind === "approval") {
          approvalWorkspaces.set(payload.interaction.approvalId, workspaceId);
        }
        finish(pauseToOutcome(payload));
      });
      signal?.addEventListener("abort", onAbort);
      start()
        .then(() => {
          // An abort that landed while start was in flight found nothing to
          // stop — re-issue now that the task is registered.
          if (signal?.aborted) onAbort();
        })
        .catch((error) => finish(
          error instanceof TargetSelectionRequiredError
            ? {
                status: "needs_human",
                reason: "Choose which matching browser tab to use.",
                targetSelection: error.selection,
              }
            : { status: "error", reason: (error as Error).message },
        ));
    });
  }

  async function executeRun(
    task: AgentTask,
    entry: SessionEntry | null,
    signal: AbortSignal | undefined,
    onTargetBound?: AgentRunOptions["onTargetBound"],
    onProgress?: AgentRunOptions["onProgress"],
  ): Promise<AgentRunOutcome> {
    if (signal?.aborted) {
      // Aborted while queued (or before dispatch): touch nothing.
      return Promise.resolve({ status: "error", reason: CANCELED_REASON });
    }
    let resolved: ResolvedTarget;
    try {
      resolved = await resolveTab(task, entry, onProgress);
    } catch (error) {
      return error instanceof TargetSelectionRequiredError
        ? {
            status: "needs_human",
            reason: "Choose which browser target or OpenSidebar workspace to use.",
            targetSelection: error.selection,
          }
        : { status: "error", reason: (error as Error).message };
    }
    const { tabId, createdForMission } = resolved;
    const workspaceId = resolved.visualWorkspaceId ?? entry?.workspaceId ?? newWorkspaceId();
    const targetContext = task.targetContext ?? "isolated_tab";
    return waitForOutcome(workspaceId, signal, async () => {
      workspaceTabs.set(workspaceId, tabId);
      await onProgress?.("Verifying the mission tab workspace and sidepanel binding.");
      let isolatedTarget: RemoteMissionTargetBindingV1 | undefined;
      if (targetContext === "isolated_tab") {
        // Prove placement before waiting on page readiness so no agent work can
        // begin from a detached tab.
        isolatedTarget = await deps.verifyIsolatedWorkspace(
          tabId,
          task.url,
          createdForMission,
        );
      }
      await deps.ensureTabReady?.(tabId);
      if (targetContext === "isolated_tab") {
        workspaceTargets.set(
          workspaceId,
          deps.ensureTabReady
            ? await deps.verifyIsolatedWorkspace(tabId, task.url, createdForMission)
            : isolatedTarget!,
        );
      } else if (deps.describeTarget) {
        workspaceTargets.set(
          workspaceId,
          await deps.describeTarget(tabId, targetContext, task.url),
        );
      }
      const boundTarget = workspaceTargets.get(workspaceId);
      if (boundTarget) await onTargetBound?.(boundTarget);
      await onProgress?.("Starting read-only browser execution on the verified target.");
      await deps.startTask({
        query: task.instruction,
        tabId,
        workspaceId,
        executionToolProfile: task.executionToolProfile,
      });
    }, targetContext === "isolated_tab"
      ? () => deps.verifyIsolatedWorkspace(tabId, task.url, createdForMission)
      : deps.describeTarget
        ? () => deps.describeTarget!(
            tabId,
            targetContext,
            task.url,
          )
        : undefined);
  }

  return {
    run(task: AgentTask, opts?: AgentRunOptions): Promise<AgentRunOutcome> {
      const signal = opts?.signal;
      if (!task.session)
        return executeRun(task, null, signal, opts?.onTargetBound, opts?.onProgress);
      let entry = sessions.get(task.session);
      if (!entry) {
        entry = { workspaceId: newWorkspaceId(), tabId: null, queue: Promise.resolve() };
        sessions.set(task.session, entry);
      }
      const sessionEntry = entry;
      const run = sessionEntry.queue.then(() =>
        executeRun(
          task,
          sessionEntry,
          signal,
          opts?.onTargetBound,
          opts?.onProgress,
        ));
      // executeRun never rejects by design, but guard the queue anyway so one
      // bad run can never wedge the session forever.
      sessionEntry.queue = run.catch(() => {});
      return run;
    },

    selectTarget(
      task: AgentTask & { session: string; targetHandle: string },
      opts?: AgentRunOptions,
    ): Promise<AgentRunOutcome> {
      let entry = sessions.get(task.session);
      if (!entry) {
        entry = { workspaceId: newWorkspaceId(), tabId: null, queue: Promise.resolve() };
        sessions.set(task.session, entry);
      }
      const sessionEntry = entry;
      const run = sessionEntry.queue.then(() => executeRun(task, sessionEntry, opts?.signal));
      sessionEntry.queue = run.catch(() => {});
      return run;
    },

    respondApproval(
      req: BrowserToolRequest,
      opts?: AgentRunOptions,
    ): Promise<AgentRunOutcome> {
      const approvalId = String(req.args.approvalId);
      const approved = req.args.approved === true;
      const entry = req.session ? sessions.get(req.session) : undefined;
      const workspaceId = entry?.workspaceId ?? approvalWorkspaces.get(approvalId);
      if (!workspaceId) {
        return Promise.resolve({
          status: "error",
          reason: "no pending approval for that id",
        });
      }
      const resume = async () => {
        const tabId = entry?.tabId ?? workspaceTabs.get(workspaceId);
        const locallyAllowed =
          !approved ||
          (tabId != null &&
            (await deps.validateApprovalContext?.(tabId)) !== false);
        const outcome = await waitForOutcome(workspaceId, opts?.signal, async () => {
          if (!deps.resolveApproval(workspaceId, {
            approvalId,
            approved: approved && locallyAllowed,
          })) {
            // Unknown / expired / already answered — error fast so the session
            // queue is never blocked on an outcome that will never arrive.
            throw new Error(
              "no pending approval (unknown, expired, or already answered)",
            );
          }
        });
        return approved && !locallyAllowed
          ? {
              status: "error" as const,
              reason: "Remote approval was denied by the current local site policy.",
            }
          : outcome;
      };
      if (!entry) return resume();
      // Join the session queue so a queued mission cannot start mid-resume.
      const run = entry.queue.then(resume);
      entry.queue = run.catch(() => {});
      return run;
    },
  };
}

/** Wire the real chrome + orchestrator + settings singletons (RFC LP-8, M2). */
export function createDefaultBrowserTaskDeps(): BrowserTaskDeps {
  return {
    async getActiveTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (typeof tab?.id !== "number")
        throw new Error("No active browser tab is available for the remote task.");
      return tab.id;
    },
    async findTabsByUrl(url) {
      const expected = new URL(url).href;
      const tabs = await chrome.tabs.query({});
      const windowIds = [...new Set(tabs.map((tab) => tab.windowId))].sort((a, b) => a - b);
      const matches = [];
      for (const tab of tabs) {
        if (typeof tab.id !== "number" || !tab.url) continue;
        try {
          if (new URL(tab.url).href !== expected) continue;
        } catch {
          continue;
        }
        let groupTitle: string | undefined;
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          groupTitle = await chrome.tabGroups.get(tab.groupId).then((group) => group.title).catch(() => undefined);
        }
        matches.push({
          tabId: tab.id,
          pageTitle: tab.title?.trim() || new URL(tab.url).hostname,
          ...(groupTitle ? { groupTitle } : {}),
          windowLabel: `Window ${windowIds.indexOf(tab.windowId) + 1}`,
        });
      }
      return matches;
    },
    async findWorkspaceTargets() {
      const tabs = await chrome.tabs.query({});
      const windowIds = [...new Set(tabs.map((tab) => tab.windowId))]
        .sort((a, b) => a - b);
      const byId = new Map(
        tabs
          .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
          .map((tab) => [tab.id, tab]),
      );
      const targets = [];
      for (const workspace of await workspaceManager.getWorkspaces()) {
        if (workspace.id === "default" || workspace.tabGroupId === null) continue;
        const source = workspace.tabIds
          .map((tabId) => byId.get(tabId))
          .find((tab) => tab?.groupId === workspace.tabGroupId);
        if (!source?.id) continue;
        const groupTitle = await chrome.tabGroups
          .get(workspace.tabGroupId)
          .then((group) => group.title?.trim())
          .catch(() => undefined);
        targets.push({
          workspaceId: workspace.id,
          sourceTabId: source.id,
          pageTitle: source.title?.trim() || "OpenSidebar workspace",
          groupTitle: groupTitle || workspace.name,
          windowLabel: `Window ${windowIds.indexOf(source.windowId) + 1}`,
        });
      }
      return targets;
    },
    async createTabInWorkspace(sourceTabId, workspaceId, url) {
      const tab = await createWorkspaceTab({ sourceTabId, workspaceId, url });
      return tab.id;
    },
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
    async tabMatchesUrl(tabId, expectedUrl) {
      try {
        const tab = await chrome.tabs.get(tabId);
        return Boolean(tab.url && new URL(tab.url).href === expectedUrl);
      } catch {
        return false;
      }
    },
    async navigateTab(tabId, url) {
      await chrome.tabs.update(tabId, { url });
    },
    async ensureTabReady(tabId) {
      if (!(await ensureContentScript(tabId, 10_000)))
        throw new Error("Browser page did not become ready for the remote task.");
    },
    async verifyIsolatedWorkspace(tabId, expectedUrl, createdForMission) {
      return verifyIsolatedTaskWorkspace(tabId, expectedUrl, createdForMission);
    },
    async describeTarget(tabId, context, expectedUrl) {
      const tab = await chrome.tabs.get(tabId);
      const workspace = await workspaceManager.getWorkspaceForTab(tabId);
      const tabs = await chrome.tabs.query({});
      const windowIds = [...new Set(tabs.map((candidate) => candidate.windowId))]
        .sort((a, b) => a - b);
      const groupTitle = workspace?.tabGroupId != null
        ? await chrome.tabGroups
            .get(workspace.tabGroupId)
            .then((group) => group.title?.trim())
            .catch(() => undefined)
        : undefined;
      const panel = await chrome.sidePanel.getOptions({ tabId }).catch(() => undefined);
      let pageOrigin: string | undefined;
      let expectedUrlMatched: boolean | undefined;
      try {
        pageOrigin = tab.url ? new URL(tab.url).origin : undefined;
        expectedUrlMatched = expectedUrl
          ? Boolean(tab.url && new URL(tab.url).href === new URL(expectedUrl).href)
          : undefined;
      } catch {
        expectedUrlMatched = expectedUrl ? false : undefined;
      }
      return {
        context,
        ...(pageOrigin && pageOrigin !== "null" ? { pageOrigin } : {}),
        ...(tab.title?.trim() ? { pageTitle: tab.title.trim().slice(0, 160) } : {}),
        ...(expectedUrlMatched === undefined ? {} : { expectedUrlMatched }),
        windowLabel: `Window ${windowIds.indexOf(tab.windowId) + 1}`,
        ...(workspace ? { workspaceTitle: (groupTitle || workspace.name).slice(0, 80) } : {}),
        inWorkspace: Boolean(workspace?.tabGroupId != null),
        sidePanelEnabled: panel?.enabled === true,
        createdForMission: false,
      };
    },
    async validateApprovalContext(tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url) return false;
        const settings = (await loadSettings()) ?? ({} as UserSettings);
        return getBlockedRuleForUrl(tab.url, settings) === null;
      } catch {
        return false;
      }
    },
    async stopTask(workspaceId) {
      await browserRuntime.stopTask(workspaceId);
    },
    resolveApproval(workspaceId, payload) {
      return browserRuntime.resolveApproval(workspaceId, payload);
    },
    async startTask({ query, tabId, workspaceId, executionToolProfile }) {
      const settings = (await loadSettings()) ?? ({} as UserSettings);
      const apiKey = await loadApiKey();
      await browserRuntime.startTask({
        query,
        tabId,
        workspaceId,
        settings,
        openRouterApiKey: resolveBrowserAgentCredential(settings, apiKey),
        // Approvals forward over the bridge — there is no sidepanel to answer
        // them; selects the longer approval timeout (pi-backend Phase 4).
        interactionDelivery: "handoff",
        executionToolProfile,
      });
    },
    addCompletionListener(fn) {
      // Completions correlate by workspaceId over the runtime's messaging seam
      // (RFC LP-15, Phase 5).
      return browserRuntime.onTaskCompletion(fn);
    },
    addPauseListener(fn) {
      return browserRuntime.onTaskPaused(fn);
    },
  };
}

/** Start the browser bridge: connect to the host and serve thick tools. */
export function createDefaultBrowserAgentRunner(): AgentRunner {
  return createBrowserAgentRunner(createDefaultBrowserTaskDeps());
}
