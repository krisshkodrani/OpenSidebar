/**
 * Shared E2E test utilities.
 *
 * Provides helpers that communicate with the extension's service worker
 * and content scripts via Puppeteer's evaluate/CDP bridge.
 */

import type { WebWorker, Page } from "puppeteer";
import type { ExtensionContext } from "./browser";
import { closeNonExtensionPages, openHelperPage } from "./browser";

type TaskCompletionState = "completed" | "partial" | "none";

function getLatestTaskCompletionState(events: any[]): TaskCompletionState {
  const completion = [...events]
    .reverse()
    .find((event: any) => event.type === "TASK_COMPLETION");
  if (completion?.status === "completed") return "completed";
  if (completion?.status === "partial") return "partial";
  return "none";
}

/**
 * Set up event monitoring in the service worker context.
 * Wraps `chrome.runtime.sendMessage` to capture AGENT_STATUS, AGENT_STEP,
 * TASK_PROGRESS, and TASK_COMPLETION events locally in `__agentEvents`.
 *
 * This avoids needing a visible helper page tab for event collection.
 */
export async function setupEventMonitor(worker: WebWorker): Promise<void> {
  await worker.evaluate(async () => {
    const g = self as any;
    if (g.__e2eEventMonitorInstalled) {
      g.__agentEvents = [];
      return;
    }

    // Check that chrome.runtime.sendMessage is available (SW should be initialized by now)
    // Note: setTimeout is unavailable in Puppeteer's CDP evaluate context for service workers,
    // so we cannot poll. If sendMessage isn't ready, we proceed without it.
    if (!g.chrome?.runtime?.sendMessage) {
      // One retry via microtask yield
      await Promise.resolve();
    }
    if (!g.chrome?.runtime?.sendMessage) {
      console.warn("[e2e] chrome.runtime.sendMessage unavailable — event monitor disabled");
      g.__agentEvents = [];
      return;
    }

    g.__agentEvents = [];
    const runtime = g.chrome.runtime;
    const origSend = runtime.sendMessage.bind(runtime);
    g.__e2eOrigSendMessage = origSend;
    runtime.sendMessage = function (...args: any[]) {
      const message = args[0];
      if (message && typeof message === "object" && typeof message.type === "string") {
        const t = message.type;
        if (
          t === "AGENT_STATUS" ||
          t === "AGENT_STEP" ||
          t === "TASK_PROGRESS" ||
          t === "TASK_COMPLETION"
        ) {
          g.__agentEvents.push({
            type: t,
            status: message?.payload?.status,
            detail: message?.payload?.detail,
            stepLabel: message?.payload?.step?.label,
            stepDetail: message?.payload?.step?.detail,
            workspaceId: message?.workspaceId ?? null,
            timestamp: Date.now(),
            // Node progression data (null for AGENT_STATUS/AGENT_STEP)
            subtasks: message?.payload?.subtasks ?? null,
            currentIndex: message?.payload?.currentIndex ?? null,
            subtaskResults: message?.payload?.subtaskResults ?? null,
          });
          if (g.__agentEvents.length > 400) g.__agentEvents.shift();
        }
      }
      return origSend(...args);
    };
    g.__e2eEventMonitorInstalled = true;
  });
}

/**
 * Retrieve the last N monitored events from the service worker.
 */
export async function getMonitoredEvents(
  worker: WebWorker,
  last: number = 30,
): Promise<any[]> {
  return worker.evaluate((n: number) => {
    const events = (self as any).__agentEvents ?? [];
    return events.slice(-n);
  }, last);
}

/**
 * Get the active tab ID from the service worker context.
 */
export async function getActiveTabId(worker: WebWorker): Promise<number> {
  return worker.evaluate(async () => {
    const [tab] = await (globalThis as any).chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab?.id ?? -1;
  });
}

/**
 * Send a DOM_SNAPSHOT_REQUEST to a tab via the service worker and return the snapshot.
 * Retries up to `maxRetries` times if the content script isn't ready yet.
 */
export async function requestSnapshot(
  worker: WebWorker,
  tabId: number,
  maxRetries: number = 5,
): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await worker.evaluate(async (tid: number) => {
        return new Promise((resolve, reject) => {
          const requestId = crypto.randomUUID();
          (globalThis as any).chrome.tabs.sendMessage(
            tid,
            {
              type: "DOM_SNAPSHOT_REQUEST",
              requestId,
              source: "background",
              payload: { refresh: true },
            },
            (response: any) => {
              if ((globalThis as any).chrome.runtime.lastError) {
                reject(new Error((globalThis as any).chrome.runtime.lastError.message));
              } else {
                resolve(response?.payload ?? response);
              }
            },
          );
        });
      }, tabId);
    } catch (err: any) {
      if (attempt < maxRetries && err.message?.includes("Receiving end does not exist")) {
        await new Promise((r) => globalThis.setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Send a TOOL_EXECUTE message to a tab via the service worker.
 * Retries if content script isn't ready.
 */
export async function sendToolExecute(
  worker: WebWorker,
  tabId: number,
  toolName: string,
  args: Record<string, unknown>,
  maxRetries: number = 5,
): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await worker.evaluate(
        async (tid: number, tool: string, toolArgs: Record<string, unknown>) => {
          return new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            (globalThis as any).chrome.tabs.sendMessage(
              tid,
              {
                type: "TOOL_EXECUTE",
                requestId,
                source: "background",
                payload: { toolName: tool, args: toolArgs, toolCallId: requestId },
              },
              (response: any) => {
                if ((globalThis as any).chrome.runtime.lastError) {
                  reject(new Error((globalThis as any).chrome.runtime.lastError.message));
                } else {
                  resolve(response?.payload ?? response);
                }
              },
            );
          });
        },
        tabId,
        toolName,
        args,
      );
    } catch (err: any) {
      if (attempt < maxRetries && err.message?.includes("Receiving end does not exist")) {
        await new Promise((r) => globalThis.setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Send a DISMISS_MODALS message to a tab via the service worker.
 */
export async function sendDismissModals(
  worker: WebWorker,
  tabId: number,
): Promise<any> {
  return worker.evaluate(async (tid: number) => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      (globalThis as any).chrome.tabs.sendMessage(
        tid,
        {
          type: "DISMISS_MODALS",
          requestId,
          source: "background",
          payload: {},
        },
        (response: any) => {
          if ((globalThis as any).chrome.runtime.lastError) {
            reject(new Error((globalThis as any).chrome.runtime.lastError.message));
          } else {
            resolve(response?.payload ?? response);
          }
        },
      );
    });
  }, tabId);
}

/**
 * Navigate a page and wait for the content script to be ready.
 * Uses a short delay after load to let the content script initialize.
 */
export async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Give content script time to initialize
  await new Promise((r) => setTimeout(r, 1000));
}

/**
 * Send USER_CHAT to the service worker to start the agent loop.
 */
export async function sendUserChat(
  ctx: ExtensionContext,
  message: string,
  tabId: number,
  workspaceId: string | null = null,
): Promise<string> {
  const effectiveWorkspaceId = workspaceId ?? `e2e-${crypto.randomUUID()}`;
  const helperPage = await openHelperPage(ctx);
  try {
    await helperPage.evaluate(
      async (msg: string, tid: number, wsId: string | null) => {
        await chrome.runtime.sendMessage({
          type: "USER_CHAT",
          requestId: crypto.randomUUID(),
          source: "sidepanel",
          payload: { text: msg, tabId: tid, workspaceId: wsId },
        });
      },
      message,
      tabId,
      effectiveWorkspaceId,
    );
  } finally {
    await helperPage.close().catch(() => {});
  }
  return effectiveWorkspaceId;
}

/**
 * Clear all monitored events in the service worker.
 * Call between test cases to reset state.
 */
export async function clearMonitoredEvents(worker: WebWorker): Promise<void> {
  await worker.evaluate(() => {
    (self as any).__agentEvents = [];
  });
}

/**
 * Assert no ghost session starts after task completion.
 * Clears monitored events, waits `quietPeriodMs`, then checks for any
 * AGENT_STATUS events with ACTING or THINKING status — which would
 * indicate the orchestrator launched a new node after the task was done.
 */
export async function assertNoGhostSession(
  worker: WebWorker,
  quietPeriodMs: number = 12_000,
  workspaceId?: string | null,
): Promise<void> {
  await clearMonitoredEvents(worker);
  await new Promise((r) => setTimeout(r, quietPeriodMs));
  const rawEvents = await getMonitoredEvents(worker, 100);
  const events =
    workspaceId == null
      ? rawEvents
      : rawEvents.filter(
          (e: any) => e.workspaceId == null || e.workspaceId === workspaceId,
        );
  const ghostEvents = events.filter(
    (e: any) =>
      e.type === "AGENT_STATUS" &&
      (e.status === "ACTING" || e.status === "THINKING"),
  );
  if (ghostEvents.length > 0) {
    console.log(
      "[e2e] GHOST SESSION DETECTED:",
      JSON.stringify(ghostEvents, null, 2),
    );
  }
  if (ghostEvents.length > 0) {
    throw new Error(
      `Ghost session detected: ${ghostEvents.length} ACTING/THINKING status event(s) ` +
        `appeared ${quietPeriodMs / 1000}s after task completion`,
    );
  }
}

/**
 * Assert node isolation: no single executor completed multiple orchestrator nodes.
 * Validates TASK_PROGRESS events show one-at-a-time progression and trace count
 * matches expected node count.
 */
export function assertNodeIsolation(
  events: any[],
  traceFiles: string[],
  expectedNodeCount?: number,
): void {
  // 1. One-at-a-time progression: check TASK_PROGRESS events with subtasks
  const progressEvents = events.filter(
    (e: any) => e.type === "TASK_PROGRESS" && Array.isArray(e.subtasks),
  );

  for (let i = 1; i < progressEvents.length; i++) {
    const prev = progressEvents[i - 1].subtasks as any[];
    const curr = progressEvents[i].subtasks as any[];
    const len = Math.min(prev.length, curr.length);
    let changedCount = 0;
    for (let j = 0; j < len; j++) {
      if (prev[j]?.status !== curr[j]?.status) changedCount++;
    }
    if (changedCount > 2) {
      throw new Error(
        `Node isolation violation: ${changedCount} subtask statuses changed between ` +
          `consecutive TASK_PROGRESS events (expected ≤2). ` +
          `Prev: ${JSON.stringify(prev.map((s: any) => s?.status))}, ` +
          `Curr: ${JSON.stringify(curr.map((s: any) => s?.status))}`,
      );
    }
  }

  // 2. TASK_COMPLETION consistency
  const completionEvents = events.filter(
    (e: any) => e.type === "TASK_COMPLETION",
  );
  const lastCompletion = completionEvents[completionEvents.length - 1];
  if (lastCompletion?.subtaskResults && expectedNodeCount != null) {
    const results = lastCompletion.subtaskResults as any[];
    if (results.length !== expectedNodeCount) {
      throw new Error(
        `Node isolation: expected ${expectedNodeCount} subtask results, ` +
          `got ${results.length}`,
      );
    }
    const failed = results.filter((r: any) => r?.status === "failed");
    if (failed.length > 0) {
      throw new Error(
        `Node isolation: ${failed.length} subtask(s) failed unexpectedly`,
      );
    }
  }

  // 3. Trace count sanity: at least as many traces as expected nodes
  if (expectedNodeCount != null && traceFiles.length < expectedNodeCount) {
    throw new Error(
      `Node isolation: expected ≥${expectedNodeCount} trace files (one per node), ` +
        `got ${traceFiles.length}`,
    );
  }
}

async function waitForAgentIdle(
  worker: WebWorker,
  timeoutMs: number = 10_000,
): Promise<void> {
  const start = Date.now();
  let observedStatus = false;

  while (Date.now() - start < timeoutMs) {
    const events = await getMonitoredEvents(worker, 30);
    const lastStatus = [...events]
      .reverse()
      .find((event: any) => event.type === "AGENT_STATUS");

    if (lastStatus) observedStatus = true;
    if (
      observedStatus &&
      (lastStatus?.status === "IDLE" || lastStatus?.status === "ERROR")
    ) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Reset extension state between tests.
 * Clears agent events and stops any running agent loop.
 */
export async function resetExtensionState(
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.browser.connected) return;

  await setupEventMonitor(ctx.serviceWorker);
  const helperPage = await openHelperPage(ctx);
  try {
    await helperPage.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: "STOP_AGENT",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        payload: {},
      });
    });
  } catch {
    // Agent may not be running — that's fine
  } finally {
    await helperPage.close().catch(() => {});
  }
  await waitForAgentIdle(ctx.serviceWorker);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const cleanupPage = await openHelperPage(ctx);
  try {
    await cleanupPage.evaluate(async () => {
      const sessionData = await chrome.storage.session.get(null);
      const keys = Object.keys(sessionData).filter(
        (key) => key === "agent_context" || key.startsWith("agent_context:"),
      );
      if (keys.length > 0) {
        await chrome.storage.session.remove(keys);
      }
    });
  } finally {
    await cleanupPage.close().catch(() => {});
  }

  await clearMonitoredEvents(ctx.serviceWorker);
  // Close ALL non-extension pages and open a fresh one.
  // Navigating to about:blank leaves the tab in a state where content scripts
  // can't inject, causing bridge disconnects on subsequent tests.
  const pages = await ctx.browser.pages();
  const nonExtPages = pages.filter((p) => !p.url().startsWith("chrome-extension://"));
  for (const p of nonExtPages) {
    await p.close().catch(() => {});
  }
  // Ensure at least one page exists for the next test
  await ctx.browser.newPage();
}

/**
 * Wait for the agent to complete a task (no page-level check needed).
 * Polls monitored events for TASK_COMPLETION, "Task complete" step, IDLE, or ERROR.
 * Useful for tasks where success is judged by trace output, not DOM state.
 */
export async function waitForTaskCompletion(
  ctx: ExtensionContext,
  timeoutMs: number,
  workspaceId: string,
): Promise<{ ok: boolean; reason: string; events: any[] }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const events = (await getMonitoredEvents(ctx.serviceWorker, 80)).filter(
      (event: any) =>
        event.workspaceId == null || event.workspaceId === workspaceId,
    );
    const completion = [...events]
      .reverse()
      .find((event: any) => event.type === "TASK_COMPLETION");
    if (completion?.status === "completed") {
      return { ok: true, reason: String(completion.status), events };
    }
    if (completion?.status === "partial") {
      return { ok: false, reason: "task_partial", events };
    }

    const taskCompleteStep = [...events]
      .reverse()
      .find(
        (event: any) =>
          event.type === "AGENT_STEP" &&
          String(event.stepLabel || "").includes("Task complete"),
      );
    if (taskCompleteStep) {
      if (getLatestTaskCompletionState(events) === "partial") {
        return { ok: false, reason: "task_partial", events };
      }
      return { ok: true, reason: "task_complete_step", events };
    }

      const lastStatus = [...events]
        .reverse()
        .find((event: any) => event.type === "AGENT_STATUS");
      if (lastStatus?.status === "IDLE") {
        if (getLatestTaskCompletionState(events) === "partial") {
          return { ok: false, reason: "task_partial", events };
        }
        return { ok: false, reason: "idle_without_completion", events };
      }
    if (lastStatus?.status === "ERROR") {
      return {
        ok: false,
        reason: `agent_error:${lastStatus.detail || "unknown"}`,
        events,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return {
    ok: false,
    reason:
      getLatestTaskCompletionState(await getMonitoredEvents(ctx.serviceWorker, 80).then((all) =>
        all.filter((event: any) => event.workspaceId == null || event.workspaceId === workspaceId),
      )) === "partial"
        ? "task_partial"
        : "timeout",
    events: await getMonitoredEvents(ctx.serviceWorker, 80),
  };
}

/**
 * Generic agent outcome poller.
 * Polls a page-level check function and monitored events until:
 *   - `checkFn` returns a truthy value (success)
 *   - AGENT_STATUS:ERROR is seen (failure)
 *   - timeout expires (failure)
 *
 * Returns { ok, reason, result, events }.
 */
export async function waitForOutcome<T>(
  page: Page,
  worker: WebWorker,
  checkFn: () => Promise<T | null | undefined>,
  timeoutMs: number,
  workspaceId?: string | null,
): Promise<{ ok: boolean; reason: string; result: T | null; events: any[] }> {
  const start = Date.now();
  let lastResult: T | null = null;
  let successObservedAt: number | null = null;
  let successfulResult: T | null = null;

  while (Date.now() - start < timeoutMs) {
    const result = await checkFn();
    if (result) {
      successfulResult = result;
      successObservedAt ??= Date.now();
    }
    lastResult = result ?? null;

    const rawEvents = await getMonitoredEvents(worker);
    const events =
      workspaceId == null
        ? rawEvents
        : rawEvents.filter(
            (event: any) =>
              event.workspaceId == null || event.workspaceId === workspaceId,
          );
    const lastTaskCompletion = [...events]
      .reverse()
      .find((e: any) => e.type === "TASK_COMPLETION");
    const lastStatus = [...events]
      .reverse()
      .find((e: any) => e.type === "AGENT_STATUS");

    if (successfulResult) {
      const taskCompleted =
        lastTaskCompletion?.status === "completed";
      const taskPartial = lastTaskCompletion?.status === "partial";
      const agentIdle = lastStatus?.status === "IDLE";
      const settledLongEnough =
        successObservedAt !== null && Date.now() - successObservedAt >= 4000;

      if (taskPartial) {
        return {
          ok: false,
          reason: "task_partial",
          result: successfulResult,
          events,
        };
      }

      if (taskCompleted || agentIdle || settledLongEnough) {
        return { ok: true, reason: "done", result: successfulResult, events };
      }
    }

    if (lastStatus?.status === "ERROR") {
      return {
        ok: false,
        reason: `agent_error:${lastStatus.detail || "unknown"}`,
        result: successfulResult ?? lastResult,
        events,
      };
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  const rawEvents = await getMonitoredEvents(worker);
  const events =
    workspaceId == null
      ? rawEvents
      : rawEvents.filter(
          (event: any) =>
            event.workspaceId == null || event.workspaceId === workspaceId,
        );
  return {
    ok: false,
    reason:
      getLatestTaskCompletionState(events) === "partial" ? "task_partial" : "timeout",
    result: successfulResult ?? lastResult,
    events,
  };
}

export const __testOnly = {
  getLatestTaskCompletionState,
};
