/**
 * Shared E2E test utilities.
 *
 * Provides helpers that communicate with the extension's service worker
 * and content scripts via Puppeteer's evaluate/CDP bridge.
 */

import type { WebWorker, Page } from "puppeteer";
import type { ExtensionContext } from "./browser";
import {
  closeNonExtensionPages,
  closeE2EPanel,
  ensureE2EPanel,
  getE2EPanelMode,
  openHelperPage,
  reloadExtension,
} from "./browser";
import {
  E2E_SEED_PENDING_INTERACTION_MESSAGE_TYPE,
  E2E_TEST_API_ENABLED_STORAGE_KEY,
} from "../../../src/background/e2e-test-api";
import { readE2EConfig } from "./e2e-config";

type TaskCompletionState =
  | "completed"
  | "partial"
  | "failed"
  | "stopped"
  | "none";
export type E2EPanelPromptEntryMode = "instant" | "visible";

export interface SendUserChatOptions {
  panelPromptEntry?: E2EPanelPromptEntryMode;
  typingDelayMs?: number;
}

function isTerminalTaskCompletionStatus(
  status: unknown,
): status is "completed" | "partial" | "failed" | "stopped" {
  return (
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "stopped"
  );
}

function getLatestTaskCompletionEvent(events: any[]): any | null {
  return (
    [...events]
      .reverse()
      .find(
        (event: any) =>
          event.type === "TASK_COMPLETION" &&
          isTerminalTaskCompletionStatus(event.status),
      ) ?? null
  );
}

function getLatestTaskCompletionState(events: any[]): TaskCompletionState {
  const completion = getLatestTaskCompletionEvent(events);
  if (completion?.status === "completed") return "completed";
  if (completion?.status === "partial") return "partial";
  if (completion?.status === "failed") return "failed";
  if (completion?.status === "stopped") return "stopped";
  return "none";
}

function describeTaskCompletionEvent(event: any): string {
  const status = String(event?.status ?? event?.completionStatus ?? "unknown");
  const detail =
    event?.detail ??
    event?.terminationReason ??
    event?.payload?.summary ??
    event?.payload?.detail ??
    "unknown";
  return `task_${status}:${detail}`;
}

function isTerminalAgentStatusEvent(event: any): boolean {
  if (event?.type !== "AGENT_STATUS") return false;
  if (event.status === "ERROR") return true;
  return (
    event.status === "IDLE" &&
    isTerminalTaskCompletionStatus(event.completionStatus)
  );
}

function getLatestTerminalWaitEvent(events: any[]): any | null {
  return (
    [...events].reverse().find((event: any) => {
      if (
        event.type === "TASK_COMPLETION" &&
        isTerminalTaskCompletionStatus(event.status)
      ) {
        return true;
      }
      return isTerminalAgentStatusEvent(event);
    }) ?? null
  );
}

function describeTerminalWaitEvent(event: any): string {
  if (event?.type === "TASK_COMPLETION") {
    return describeTaskCompletionEvent(event);
  }

  const status = String(event?.status ?? "unknown").toLowerCase();
  const completionStatus =
    typeof event?.completionStatus === "string"
      ? `_${event.completionStatus}`
      : "";
  const detail =
    event?.detail ??
    event?.payload?.detail ??
    event?.payload?.summary ??
    event?.payload?.error ??
    "unknown";
  return `agent_${status}${completionStatus}:${detail}`;
}

function throwIfTaskAlreadyFinished(events: any[], waitLabel: string): void {
  const terminal = getLatestTerminalWaitEvent(events);
  if (!terminal) return;
  throw new Error(
    `${waitLabel} ended early because the task already finished: ${describeTerminalWaitEvent(
      terminal,
    )}`,
  );
}

function hasIdleAfterTerminalCompletion(events: any[]): boolean {
  const completion = getLatestTaskCompletionEvent(events);
  if (!completion) return false;

  return events.some(
    (event: any) =>
      event.type === "AGENT_STATUS" &&
      event.status === "IDLE" &&
      typeof event.timestamp === "number" &&
      typeof completion.timestamp === "number" &&
      event.timestamp >= completion.timestamp,
  );
}

function isTransientPageEvaluationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(?:execution context was destroyed|cannot find context|context destroyed|frame was detached|navigating|navigation)\b/i.test(
    message,
  );
}

const PANEL_PROMPT_SUBMIT_TIMEOUT_MS = 15_000;
const SERVICE_WORKER_EVALUATE_TIMEOUT_MS = 3_000;
const RESET_CLEANUP_OPERATION_TIMEOUT_MS = 5_000;
const DEFAULT_VISIBLE_PANEL_TYPING_DELAY_MS = 10;

function withE2ETimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function warnResetCleanup(label: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[e2e] Reset cleanup skipped ${label}: ${detail}`);
}

function panelRootLookupScript(mode: "overlay" | "detached"): string {
  if (mode === "overlay") {
    return `
      const host = document.getElementById("opensidebar-harness-host");
      const root = host && host.shadowRoot;
    `;
  }
  return "const root = document;";
}

function panelTextareaReadyExpression(mode: "overlay" | "detached"): string {
  return `(() => {
    ${panelRootLookupScript(mode)}
    return Boolean(root && root.querySelector("textarea"));
  })()`;
}

function panelSubmitReadyExpression(mode: "overlay" | "detached"): string {
  return `(() => {
    ${panelRootLookupScript(mode)}
    const textarea = root && root.querySelector("textarea");
    const button =
      root &&
      root.querySelector('button[aria-label="Send message"], button[aria-label="Send guidance"]');
    return Boolean(
      textarea &&
      textarea.value.trim().length > 0 &&
      button &&
      !(button instanceof HTMLButtonElement && button.disabled)
    );
  })()`;
}

function panelSetPromptExpression(
  mode: "overlay" | "detached",
  message: string,
): string {
  return `(() => new Promise((resolve) => {
    ${panelRootLookupScript(mode)}
    const textarea = root && root.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      resolve({ ok: false, reason: "textarea-missing" });
      return;
    }
    const value = ${JSON.stringify(message)};
    textarea.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (setter) {
      setter.call(textarea, value);
    } else {
      textarea.value = value;
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const button =
          root &&
          root.querySelector('button[aria-label="Send message"], button[aria-label="Send guidance"]');
        resolve({
          ok: true,
          value: textarea.value,
          buttonDisabled:
            button instanceof HTMLButtonElement ? button.disabled : null,
        });
      });
    });
  }))()`;
}

function panelTypePromptExpression(
  mode: "overlay" | "detached",
  message: string,
  delayMs: number,
): string {
  return `(() => new Promise((resolve) => {
    ${panelRootLookupScript(mode)}
    const textarea = root && root.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      resolve({ ok: false, reason: "textarea-missing" });
      return;
    }
    const value = ${JSON.stringify(message)};
    const delayMs = ${JSON.stringify(delayMs)};
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    const setValue = (nextValue) => {
      if (setter) {
        setter.call(textarea, nextValue);
      } else {
        textarea.value = nextValue;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };
    let index = 0;
    textarea.focus();
    setValue("");

    const appendNext = () => {
      if (index >= value.length) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const button =
              root &&
              root.querySelector('button[aria-label="Send message"], button[aria-label="Send guidance"]');
            resolve({
              ok: true,
              value: textarea.value,
              buttonDisabled:
                button instanceof HTMLButtonElement ? button.disabled : null,
            });
          });
        });
        return;
      }
      index += 1;
      setValue(value.slice(0, index));
      setTimeout(appendNext, delayMs);
    };

    appendNext();
  }))()`;
}

function panelFocusTextareaExpression(mode: "overlay" | "detached"): string {
  return `(() => {
    ${panelRootLookupScript(mode)}
    const textarea = root && root.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    textarea.focus();
    return true;
  })()`;
}

function panelBlurActiveExpression(mode: "overlay" | "detached"): string {
  return `(() => new Promise((resolve) => {
    ${panelRootLookupScript(mode)}
    const blurElement = (element) => {
      if (element instanceof HTMLElement) element.blur();
    };
    blurElement(document.activeElement);
    if (root) blurElement(root.activeElement);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve(true));
    });
  }))()`;
}

async function getPuppeteerPageForChromeTab(
  ctx: ExtensionContext,
  tabId: number,
): Promise<Page | null> {
  const helperPage = await openHelperPage(ctx);
  const tabUrl = await helperPage.evaluate(`(async () => {
    try {
      const tab = await chrome.tabs.get(${JSON.stringify(tabId)});
      return tab.url || null;
    } catch {
      return null;
    }
  })()`);
  if (typeof tabUrl !== "string" || tabUrl.length === 0) return null;

  const pages = await ctx.browser.pages();
  return (
    pages.find((page) => !page.isClosed() && page.url() === tabUrl) ?? null
  );
}

async function submitPromptOnPanelPage(
  page: Page,
  mode: "overlay" | "detached",
  message: string,
  options: SendUserChatOptions = {},
): Promise<void> {
  await page.bringToFront().catch(() => {});
  await page.waitForFunction(panelTextareaReadyExpression(mode), {
    timeout: PANEL_PROMPT_SUBMIT_TIMEOUT_MS,
  });
  const result =
    options.panelPromptEntry === "visible"
      ? await page.evaluate(
          panelTypePromptExpression(
            mode,
            message,
            options.typingDelayMs ?? DEFAULT_VISIBLE_PANEL_TYPING_DELAY_MS,
          ),
        )
      : await page.evaluate(panelSetPromptExpression(mode, message));
  if (!result || typeof result !== "object" || !(result as any).ok) {
    throw new Error(
      `E2E panel prompt injection failed: ${(result as any)?.reason ?? "unknown"}`,
    );
  }
  await page.waitForFunction(panelSubmitReadyExpression(mode), {
    timeout: PANEL_PROMPT_SUBMIT_TIMEOUT_MS,
  });
  await page.evaluate(panelFocusTextareaExpression(mode));
  await page.keyboard.press("Enter");
  await page.evaluate(panelBlurActiveExpression(mode)).catch(() => {});
}

async function submitUserChatThroughE2EPanel(
  ctx: ExtensionContext,
  message: string,
  tabId: number,
  options: SendUserChatOptions = {},
): Promise<boolean> {
  const mode = getE2EPanelMode();
  if (mode === "off") return false;

  if (mode === "detached") {
    const panelPage = ctx.detachedPanelPage;
    if (!panelPage || panelPage.isClosed()) {
      throw new Error("Detached E2E panel is not available for prompt input.");
    }
    await submitPromptOnPanelPage(panelPage, "detached", message, options);
    return true;
  }

  const targetPage = await getPuppeteerPageForChromeTab(ctx, tabId);
  if (!targetPage) {
    throw new Error(`Could not find Puppeteer page for tab ${tabId}.`);
  }
  await submitPromptOnPanelPage(targetPage, "overlay", message, options);
  return true;
}

async function collectE2EPanelSubmitDiagnostics(
  ctx: ExtensionContext,
  tabId: number,
): Promise<Record<string, unknown>> {
  const mode = getE2EPanelMode();
  if (mode === "off") return { mode };

  const panelPage =
    mode === "detached"
      ? ctx.detachedPanelPage
      : await getPuppeteerPageForChromeTab(ctx, tabId);
  if (!panelPage || panelPage.isClosed()) {
    return { mode, panelPageFound: false };
  }

  return {
    mode,
    panelPageFound: true,
    ...(await panelPage.evaluate((panelMode: "overlay" | "detached") => {
      const root =
        panelMode === "overlay"
          ? document.getElementById("opensidebar-harness-host")?.shadowRoot
          : document;
      const mount = root?.getElementById("root");
      const textarea = root?.querySelector("textarea");
      const button = root?.querySelector(
        'button[aria-label="Send message"], button[aria-label="Send guidance"]',
      );
      const sentMessages =
        (window as any).__opensidebarOverlayRuntime?.sentMessages ?? [];
      return {
        hostExists:
          panelMode === "detached" ||
          Boolean(document.getElementById("opensidebar-harness-host")),
        ready: Boolean(mount?.hasAttribute("data-opensidebar-ready")),
        textareaFound: textarea instanceof HTMLTextAreaElement,
        textareaTextLength:
          textarea instanceof HTMLTextAreaElement ? textarea.value.length : null,
        buttonFound: button instanceof HTMLButtonElement,
        buttonDisabled:
          button instanceof HTMLButtonElement ? button.disabled : null,
        activeElementTag:
          root?.activeElement instanceof Element
            ? root.activeElement.tagName
            : null,
        sentMessages: Array.isArray(sentMessages)
          ? sentMessages.slice(-5).map((message: any) => ({
              type: message?.type,
              source: message?.source,
              workspaceId: message?.payload?.workspaceId,
              tabId: message?.payload?.tabId,
              payloadTextLength:
                typeof message?.payload?.text === "string"
                  ? message.payload.text.length
                  : null,
            }))
          : null,
      };
    }, mode as "overlay" | "detached")),
  };
}

/**
 * Set up event monitoring in the service worker context.
 * Wraps `chrome.runtime.sendMessage` to capture key background runtime events
 * locally in `__agentEvents`.
 *
 * This avoids needing a visible helper page tab for event collection.
 */
export async function setupEventMonitor(worker: WebWorker): Promise<void> {
  const eventBufferLimit = readE2EConfig().diagnostic ? 2_000 : 400;
  const script = `
(async () => {
    const bufferLimit = ${JSON.stringify(eventBufferLimit)};
    const g = self;
    if (g.__e2eEventMonitorInstalled) {
      g.__agentEvents = [];
      g.__e2eEventBufferLimit = bufferLimit;
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
    g.__e2eEventBufferLimit = bufferLimit;
    const captureMessage = (message, channel) => {
      if (message && typeof message === "object" && typeof message.type === "string") {
        const t = message.type;
        const lowerType = t.toLowerCase();
        if (
          t === "AGENT_STATUS" ||
          t === "USER_CHAT_ACCEPTED" ||
          t === "AGENT_ACTIVITY" ||
          t === "AGENT_STEP" ||
          t === "TASK_PROGRESS" ||
          t === "TASK_COMPLETION" ||
          t === "STREAM_CHUNK" ||
          t === "APPROVAL_REQUEST" ||
          t === "CLARIFICATION_REQUEST" ||
          t === "TASK_RECOVERY" ||
          lowerType.includes("memory")
        ) {
          g.__agentEvents.push({
            type: t,
            channel,
            status: message?.payload?.status,
            completionStatus: message?.payload?.completionStatus,
            detail: message?.payload?.detail,
            active: message?.payload?.active ?? null,
            outcome: message?.payload?.outcome ?? null,
            laneTelemetry: message?.payload?.laneTelemetry ?? null,
            stepLabel: message?.payload?.step?.label,
            stepDetail: message?.payload?.step?.detail,
            workspaceId: message?.workspaceId ?? null,
            timestamp: Date.now(),
            // Node progression data (null for AGENT_STATUS/AGENT_STEP)
            subtasks: message?.payload?.subtasks ?? null,
            currentIndex: message?.payload?.currentIndex ?? null,
            subtaskResults: message?.payload?.subtaskResults ?? null,
            approvalId: message?.payload?.approvalId ?? null,
            approved: message?.payload?.approved ?? null,
            clarificationId: message?.payload?.clarificationId ?? null,
            question: message?.payload?.question ?? null,
            context: message?.payload?.context ?? null,
            timeoutMs: message?.payload?.timeoutMs ?? null,
            payload: message?.payload ?? null,
          });
          if (g.__agentEvents.length > g.__e2eEventBufferLimit) g.__agentEvents.shift();
        }
      }
    };

    const runtime = g.chrome.runtime;
    const origSend = runtime.sendMessage.bind(runtime);
    g.__e2eOrigSendMessage = origSend;
    runtime.sendMessage = function (...args) {
      captureMessage(args[0], "runtime");
      return origSend(...args);
    };
    if (g.chrome?.tabs?.sendMessage) {
      const origTabsSend = g.chrome.tabs.sendMessage.bind(g.chrome.tabs);
      g.__e2eOrigTabsSendMessage = origTabsSend;
      g.chrome.tabs.sendMessage = function (...args) {
        captureMessage(args[1], "tabs");
        return origTabsSend(...args);
      };
    }
    g.__e2eEventMonitorInstalled = true;
})()
  `;
  await worker.evaluate(script);
}

/**
 * Retrieve the last N monitored events from the service worker.
 */
export async function getMonitoredEvents(
  worker: WebWorker,
  last: number = 30,
): Promise<any[]> {
  return withE2ETimeout(
    worker.evaluate((n: number) => {
      const events = (self as any).__agentEvents ?? [];
      return events.slice(-n);
    }, last),
    SERVICE_WORKER_EVALUATE_TIMEOUT_MS,
    "Monitored event read",
  );
}

export async function getAgentActivityEvents(
  worker: WebWorker,
  last: number = 80,
  workspaceId?: string | null,
): Promise<any[]> {
  const events = await getMonitoredEvents(worker, last);
  return events.filter(
    (event: any) =>
      event.type === "AGENT_ACTIVITY" &&
      (workspaceId == null ||
        event.workspaceId == null ||
        event.workspaceId === workspaceId),
  );
}

export async function getMemoryEvents(
  worker: WebWorker,
  last: number = 80,
  workspaceId?: string | null,
): Promise<any[]> {
  const events = await getMonitoredEvents(worker, last);
  return events.filter((event: any) => {
    const type = String(event?.type ?? "").toLowerCase();
    return (
      type.includes("memory") &&
      (workspaceId == null ||
        event.workspaceId == null ||
        event.workspaceId === workspaceId)
    );
  });
}

export async function waitForMonitoredEvent(
  worker: WebWorker,
  predicate: (event: any) => boolean,
  timeoutMs: number = 20_000,
  workspaceId?: string | null,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rawEvents = await getMonitoredEvents(worker, 120);
    const events =
      workspaceId == null
        ? rawEvents
        : rawEvents.filter(
            (event: any) =>
              event.workspaceId == null || event.workspaceId === workspaceId,
          );
    const match = [...events].reverse().find(predicate);
    if (match) return match;
    throwIfTaskAlreadyFinished(events, "Wait for monitored event");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for monitored event`);
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
                reject(
                  new Error(
                    (globalThis as any).chrome.runtime.lastError.message,
                  ),
                );
              } else {
                resolve(response?.payload ?? response);
              }
            },
          );
        });
      }, tabId);
    } catch (err: any) {
      if (
        attempt < maxRetries &&
        err.message?.includes("Receiving end does not exist")
      ) {
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
        async (
          tid: number,
          tool: string,
          toolArgs: Record<string, unknown>,
        ) => {
          return new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            (globalThis as any).chrome.tabs.sendMessage(
              tid,
              {
                type: "TOOL_EXECUTE",
                requestId,
                source: "background",
                payload: {
                  toolName: tool,
                  args: toolArgs,
                  toolCallId: requestId,
                },
              },
              (response: any) => {
                if ((globalThis as any).chrome.runtime.lastError) {
                  reject(
                    new Error(
                      (globalThis as any).chrome.runtime.lastError.message,
                    ),
                  );
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
      if (
        attempt < maxRetries &&
        err.message?.includes("Receiving end does not exist")
      ) {
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
            reject(
              new Error((globalThis as any).chrome.runtime.lastError.message),
            );
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
export async function navigateAndWait(
  page: Page,
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  await page.bringToFront().catch(() => {});
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
  await page.bringToFront().catch(() => {});
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
  options: SendUserChatOptions = {},
): Promise<string> {
  const effectiveWorkspaceId = workspaceId ?? `e2e-${crypto.randomUUID()}`;
  await ensureE2EPanel(ctx, tabId, effectiveWorkspaceId);
  const panelSubmitStartedAt = Date.now();
  const sentViaPanel = await submitUserChatThroughE2EPanel(
    ctx,
    message,
    tabId,
    options,
  );
  if (sentViaPanel) {
    const expectedText = message.trim();
    try {
      await waitForMonitoredEvent(
        ctx.serviceWorker,
        (event: any) =>
          event.type === "USER_CHAT_ACCEPTED" &&
          event.timestamp >= panelSubmitStartedAt &&
          event.payload?.text === expectedText,
        20_000,
        effectiveWorkspaceId,
      );
    } catch (error) {
      const diagnostics = await collectE2EPanelSubmitDiagnostics(
        ctx,
        tabId,
      ).catch((diagnosticError) => ({
        error:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
      }));
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${detail}. E2E panel submit diagnostics: ${JSON.stringify(
          diagnostics,
        )}`,
      );
    }
    return effectiveWorkspaceId;
  }

  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(
    async (msg: string, tid: number, wsId: string | null) => {
      const messageId = crypto.randomUUID();
      await chrome.runtime.sendMessage({
        type: "USER_CHAT",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        payload: {
          text: msg,
          tabId: tid,
          workspaceId: wsId,
          messageId,
          timestamp: Date.now(),
        },
      });
    },
    message,
    tabId,
    effectiveWorkspaceId,
  );
  return effectiveWorkspaceId;
}

export async function stopAgent(
  ctx: ExtensionContext,
  workspaceId?: string | null,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(async (wsId: string | null) => {
    await chrome.runtime.sendMessage({
      type: "STOP_AGENT",
      requestId: crypto.randomUUID(),
      source: "sidepanel",
      payload: { workspaceId: wsId },
    });
  }, workspaceId ?? null);
}

export interface StartPassiveMonitorOptions {
  instructions: string;
  inputSources?: string[];
  minIntervalMs?: number;
  maxSuggestionsPerMinute?: number;
}

/**
 * Start Watch Mode (the passive monitor) on a tab, the same way the sidepanel's
 * WatchModeControl does — by sending PASSIVE_MONITOR_START. Opens the E2E panel
 * first so the workspace exists and suggestions render into it.
 */
export async function startPassiveMonitor(
  ctx: ExtensionContext,
  tabId: number,
  workspaceId: string,
  options: StartPassiveMonitorOptions,
): Promise<void> {
  await ensureE2EPanel(ctx, tabId, workspaceId);
  const helperPage = await openHelperPage(ctx);
  const result = (await helperPage.evaluate(
    async (tid: number, wsId: string, opts: StartPassiveMonitorOptions) => {
      return await chrome.runtime.sendMessage({
        type: "PASSIVE_MONITOR_START",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        workspaceId: wsId,
        payload: {
          tabId: tid,
          workspaceId: wsId,
          instructions: opts.instructions,
          inputSources: opts.inputSources ?? ["page"],
          minIntervalMs: opts.minIntervalMs ?? 1500,
          maxSuggestionsPerMinute: opts.maxSuggestionsPerMinute ?? 6,
        },
      });
    },
    tabId,
    workspaceId,
    options,
  )) as { ok?: boolean; detail?: string } | undefined;
  if (result && result.ok === false) {
    throw new Error(`PASSIVE_MONITOR_START failed: ${result.detail}`);
  }
}

/**
 * Register a collector on the helper page for PASSIVE_MONITOR_SUGGESTION
 * broadcasts. Call BEFORE the monitored page changes so no suggestion is missed.
 */
export async function armPassiveSuggestionCollector(
  ctx: ExtensionContext,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(() => {
    const w = window as any;
    if (w.__passiveSuggestions) return;
    w.__passiveSuggestions = [];
    w.__passiveStatuses = [];
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message && message.type === "PASSIVE_MONITOR_SUGGESTION") {
        w.__passiveSuggestions.push(message.payload);
      }
      if (message && message.type === "PASSIVE_MONITOR_STATUS") {
        w.__passiveStatuses.push(message.payload);
      }
    });
  });
}

export async function stopPassiveMonitor(
  ctx: ExtensionContext,
  workspaceId: string,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(async (wsId: string) => {
    await chrome.runtime.sendMessage({
      type: "PASSIVE_MONITOR_STOP",
      requestId: crypto.randomUUID(),
      source: "sidepanel",
      workspaceId: wsId,
      payload: { workspaceId: wsId },
    });
  }, workspaceId);
}

export interface PassiveSuggestion {
  answer: string;
  confidence?: string;
  evidence?: string[];
  suggestionId?: string;
}

/** Poll the collector until a passive suggestion arrives (or time out). */
export async function waitForPassiveSuggestion(
  ctx: ExtensionContext,
  timeoutMs = 30_000,
): Promise<PassiveSuggestion> {
  const helperPage = await openHelperPage(ctx);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await helperPage.evaluate(() => {
      const list = (window as any).__passiveSuggestions;
      return Array.isArray(list) && list.length ? list[0] : null;
    })) as PassiveSuggestion | null;
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    "No PASSIVE_MONITOR_SUGGESTION broadcast within the timeout window",
  );
}

export async function sendApprovalResponse(
  ctx: ExtensionContext,
  approvalId: string,
  approved: boolean,
  workspaceId: string,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(
    async (id: string, decision: boolean, wsId: string) => {
      await chrome.runtime.sendMessage({
        type: "APPROVAL_RESPONSE",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        workspaceId: wsId,
        payload: { approvalId: id, approved: decision },
      });
    },
    approvalId,
    approved,
    workspaceId,
  );
}

export async function seedPendingInteraction(
  ctx: ExtensionContext,
  input: {
    workspaceId?: string | null;
    tabId: number;
    interaction:
      | {
          kind: "approval";
          toolName: string;
          args?: Record<string, unknown>;
          context: string;
        }
      | {
          kind: "clarification";
          question: string;
          suggestions?: string[];
        };
  },
): Promise<{
  taskId: string;
  workspaceId: string;
  interactionId: string;
}> {
  const workspaceId = input.workspaceId ?? `e2e-${crypto.randomUUID()}`;
  await ensureE2EPanel(ctx, input.tabId, workspaceId);
  const helperPage = await openHelperPage(ctx);
  const response = await helperPage.evaluate(
    async (
      config: {
        messageType: string;
        testApiEnabledKey: string;
      },
      payload: {
        tabId: number;
        workspaceId: string;
        interaction:
          | {
              kind: "approval";
              toolName: string;
              args?: Record<string, unknown>;
              context: string;
            }
          | {
              kind: "clarification";
              question: string;
              suggestions?: string[];
            };
      },
    ) => {
      await chrome.storage.local.set({ [config.testApiEnabledKey]: true });
      return await chrome.runtime.sendMessage({
        type: config.messageType,
        requestId: crypto.randomUUID(),
        source: "e2e",
        payload,
      });
    },
    {
      messageType: E2E_SEED_PENDING_INTERACTION_MESSAGE_TYPE,
      testApiEnabledKey: E2E_TEST_API_ENABLED_STORAGE_KEY,
    },
    {
      tabId: input.tabId,
      workspaceId,
      interaction: input.interaction,
    },
  );

  if (!response?.ok) {
    throw new Error(response?.detail || "Failed to seed pending interaction");
  }

  return {
    taskId: String(response.taskId),
    workspaceId,
    interactionId: String(response.interactionId),
  };
}

export async function sendClarificationResponse(
  ctx: ExtensionContext,
  clarificationId: string,
  answer: string,
  workspaceId: string,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(
    async (id: string, response: string, wsId: string) => {
      await chrome.runtime.sendMessage({
        type: "CLARIFICATION_RESPONSE",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        workspaceId: wsId,
        payload: { clarificationId: id, answer: response },
      });
    },
    clarificationId,
    answer,
    workspaceId,
  );
}

export async function updateUserSettings(
  ctx: ExtensionContext,
  patch: Record<string, unknown>,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(async (nextPatch: Record<string, unknown>) => {
    const existing =
      ((await chrome.storage.sync.get("userSettings")).userSettings as
        | Record<string, unknown>
        | undefined) ?? {};
    await chrome.storage.sync.set({
      userSettings: { ...existing, ...nextPatch },
    });
  }, patch);
}

export async function resyncWorkspace(
  ctx: ExtensionContext,
  workspaceId: string,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(async (wsId: string) => {
    await chrome.runtime.sendMessage({
      type: "WORKSPACE_SYNC",
      requestId: crypto.randomUUID(),
      source: "sidepanel",
      payload: { workspaceId: wsId },
    });
  }, workspaceId);
}

export async function restartExtensionAndMonitor(
  ctx: ExtensionContext,
): Promise<void> {
  await reloadExtension(ctx);
  await setupEventMonitor(ctx.serviceWorker);
}

export async function waitForLocalCheckpointPersisted(
  ctx: ExtensionContext,
  workspaceId: string,
  timeoutMs: number = 15_000,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = await helperPage.evaluate(async (wsId: string) => {
      const localData = await chrome.storage.local.get(null);
      const checkpoints =
        (localData["opensidebar:orchestrator:checkpoints"] as
          | Record<string, unknown>
          | undefined) ?? {};
      const hasOrchestratorCheckpoint = Boolean(checkpoints[wsId]);
      const hasTurnCheckpoint = Object.keys(localData).some((key) =>
        key.startsWith(`opensidebar:turn-checkpoint:${wsId}:`),
      );
      return hasOrchestratorCheckpoint || hasTurnCheckpoint;
    }, workspaceId);

    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for local checkpoints for workspace ${workspaceId}`,
  );
}

export async function clearLocalCheckpointsForWorkspace(
  ctx: ExtensionContext,
  workspaceId: string,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  await helperPage.evaluate(async (wsId: string) => {
    const localData = await chrome.storage.local.get(null);
    const removeKeys = Object.keys(localData).filter((key) =>
      key.startsWith(`opensidebar:turn-checkpoint:${wsId}:`),
    );
    const checkpoints =
      (localData["opensidebar:orchestrator:checkpoints"] as
        | Record<string, unknown>
        | undefined) ?? {};

    if (checkpoints[wsId] !== undefined) {
      delete checkpoints[wsId];
      await chrome.storage.local.set({
        "opensidebar:orchestrator:checkpoints": checkpoints,
      });
    }

    if (removeKeys.length > 0) {
      await chrome.storage.local.remove(removeKeys);
    }
  }, workspaceId);
}

export async function getUserTabUrls(worker: WebWorker): Promise<string[]> {
  return worker.evaluate(async () => {
    const tabs = await (globalThis as any).chrome.tabs.query({});
    return tabs
      .map((tab: any) => tab?.url)
      .filter(
        (url: string | undefined) =>
          typeof url === "string" &&
          !url.startsWith("chrome-extension://") &&
          url !== "about:blank",
      );
  });
}

export async function waitForTabCount(
  worker: WebWorker,
  expectedCount: number,
  timeoutMs: number = 20_000,
  workspaceId?: string | null,
): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const urls = await getUserTabUrls(worker);
    if (urls.length === expectedCount) return urls;
    const rawEvents = await getMonitoredEvents(worker, 120);
    const events =
      workspaceId == null
        ? rawEvents
        : rawEvents.filter(
            (event: any) =>
              event.workspaceId == null || event.workspaceId === workspaceId,
          );
    throwIfTaskAlreadyFinished(events, `Wait for ${expectedCount} user tabs`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${expectedCount} user tabs`,
  );
}

/**
 * Clear all monitored events in the service worker.
 * Call between test cases to reset state.
 */
export async function clearMonitoredEvents(worker: WebWorker): Promise<void> {
  await withE2ETimeout(
    worker.evaluate(() => {
      (self as any).__agentEvents = [];
    }),
    SERVICE_WORKER_EVALUATE_TIMEOUT_MS,
    "Monitored event clear",
  );
}

/**
 * Assert no ghost session starts after task completion.
 * Clears monitored events, waits `quietPeriodMs`, then checks for any
 * AGENT_STATUS events with ACTING or THINKING status — which would
 * indicate the orchestrator launched a new node after the task was done.
 */
export async function assertNoGhostSession(
  worker: WebWorker,
  quietPeriodMs: number = 2_000,
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

export async function waitForWorkspaceIdle(
  worker: WebWorker,
  workspaceId: string,
  timeoutMs: number = 15_000,
): Promise<void> {
  const start = Date.now();
  let sawWorkspaceEvent = false;

  while (Date.now() - start < timeoutMs) {
    const events = (await getMonitoredEvents(worker, 80)).filter(
      (event: any) =>
        event.workspaceId == null || event.workspaceId === workspaceId,
    );
    if (events.length > 0) sawWorkspaceEvent = true;
    if (sawWorkspaceEvent && hasIdleAfterTerminalCompletion(events)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Workspace ${workspaceId} did not become idle within ${timeoutMs}ms`,
  );
}

export async function settleWorkspaceBetweenTurns(
  worker: WebWorker,
  workspaceId: string,
  settleDelayMs: number = 0,
): Promise<void> {
  await waitForWorkspaceIdle(worker, workspaceId);
  if (settleDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
  }
  await clearMonitoredEvents(worker);
}

/**
 * Reset extension state between tests.
 * Clears agent events and stops any running agent loop.
 */
export async function resetExtensionState(
  ctx: ExtensionContext,
): Promise<Page | null> {
  if (!ctx.browser.connected) return null;

  await closeE2EPanel(ctx).catch((error) =>
    warnResetCleanup("E2E panel close", error),
  );
  await withE2ETimeout(
    setupEventMonitor(ctx.serviceWorker),
    RESET_CLEANUP_OPERATION_TIMEOUT_MS,
    "Event monitor setup",
  ).catch((error) => warnResetCleanup("event monitor setup", error));
  const helperPage = await openHelperPage(ctx);
  try {
    await withE2ETimeout(
      helperPage.evaluate(async () => {
        await chrome.runtime.sendMessage({
          type: "STOP_AGENT",
          requestId: crypto.randomUUID(),
          source: "sidepanel",
          payload: {},
        });
      }),
      RESET_CLEANUP_OPERATION_TIMEOUT_MS,
      "Stop agent cleanup",
    );
  } catch {
    // Agent may not be running — that's fine
  }
  await waitForAgentIdle(ctx.serviceWorker).catch((error) =>
    warnResetCleanup("agent idle wait", error),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));

  const cleanupPage = await openHelperPage(ctx);
  await withE2ETimeout(
    cleanupPage.evaluate(async () => {
      const sessionData = await chrome.storage.session.get(null);
      const keys = Object.keys(sessionData).filter(
        (key) => key === "agent_context" || key.startsWith("agent_context:"),
      );
      if (keys.length > 0) {
        await chrome.storage.session.remove(keys);
      }
    }),
    RESET_CLEANUP_OPERATION_TIMEOUT_MS,
    "Session cleanup",
  ).catch((error) => warnResetCleanup("session storage cleanup", error));

  await clearMonitoredEvents(ctx.serviceWorker).catch((error) =>
    warnResetCleanup("event clear", error),
  );
  // Close ALL non-extension pages and open a fresh one.
  // Navigating to about:blank leaves the tab in a state where content scripts
  // can't inject, causing bridge disconnects on subsequent tests.
  await closeNonExtensionPages(ctx);
  // Ensure at least one page exists for the next test
  return ctx.browser.newPage();
}

/**
 * Wait for the agent to complete a task (no page-level check needed).
 * Polls monitored events for terminal TASK_COMPLETION or ERROR.
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
    const completion = getLatestTaskCompletionEvent(events);
    const latestProgress = [...events]
      .reverse()
      .find(
        (event: any) =>
          event.type === "TASK_PROGRESS" && Array.isArray(event.subtasks),
      );
    const latestSubtasks = Array.isArray(latestProgress?.subtasks)
      ? latestProgress.subtasks
      : [];
    const hasMultiNodePlan = latestSubtasks.length > 1;
    const planStillInFlight =
      hasMultiNodePlan &&
      latestSubtasks.some(
        (subtask: any) =>
          subtask?.status !== "completed" && subtask?.status !== "skipped",
      );
    if (completion?.status === "completed") {
      return { ok: true, reason: String(completion.status), events };
    }
    if (completion?.status === "partial") {
      return { ok: false, reason: "task_partial", events };
    }
    if (completion?.status === "failed") {
      return {
        ok: false,
        reason: `task_failed:${completion.detail || completion.terminationReason || "unknown"}`,
        events,
      };
    }
    if (completion?.status === "stopped") {
      return {
        ok: false,
        reason: `task_stopped:${completion.detail || completion.terminationReason || "unknown"}`,
        events,
      };
    }

    const lastStatus = [...events]
      .reverse()
      .find((event: any) => event.type === "AGENT_STATUS");
    if (lastStatus?.status === "IDLE") {
      if (lastStatus.completionStatus === "completed") {
        return { ok: true, reason: "completed", events };
      }
      if (lastStatus.completionStatus === "partial") {
        return { ok: false, reason: "task_partial", events };
      }
      if (lastStatus.completionStatus === "failed") {
        return {
          ok: false,
          reason: `task_failed:${lastStatus.detail || "unknown"}`,
          events,
        };
      }
      if (lastStatus.completionStatus === "stopped") {
        return {
          ok: false,
          reason: `task_stopped:${lastStatus.detail || "unknown"}`,
          events,
        };
      }
      if (getLatestTaskCompletionState(events) === "partial") {
        return { ok: false, reason: "task_partial", events };
      }
      if (!planStillInFlight) {
        return { ok: false, reason: "idle_without_completion", events };
      }
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

  const finalEvents = await getMonitoredEvents(ctx.serviceWorker, 80).then(
    (all) =>
      all.filter(
        (event: any) =>
          event.workspaceId == null || event.workspaceId === workspaceId,
      ),
  );
  const finalCompletionState = getLatestTaskCompletionState(finalEvents);

  return {
    ok: false,
    reason:
      finalCompletionState === "partial"
        ? "task_partial"
        : finalCompletionState === "stopped"
          ? "task_stopped"
          : "timeout",
    events: finalEvents,
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
  let successfulResult: T | null = null;
  // Once the task has completed, the page state is final modulo a short
  // settling lag — a few more polls, then report the mismatch instead of
  // burning the whole timeout on an outcome that can no longer change.
  const COMPLETED_GRACE_POLLS = 3;
  let completedPollsRemaining: number | null = null;

  while (Date.now() - start < timeoutMs) {
    let result: T | null | undefined = null;
    try {
      result = await checkFn();
    } catch (error) {
      if (!isTransientPageEvaluationError(error)) {
        throw error;
      }
      result = null;
    }
    if (result) {
      successfulResult = result;
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

    if (lastTaskCompletion?.status === "partial") {
      return {
        ok: false,
        reason: "task_partial",
        result: successfulResult ?? lastResult,
        events,
      };
    }

    if (lastTaskCompletion?.status === "failed") {
      return {
        ok: false,
        reason: `task_failed:${lastTaskCompletion.detail || lastTaskCompletion.payload?.summary || "unknown"}`,
        result: successfulResult ?? lastResult,
        events,
      };
    }
    if (lastTaskCompletion?.status === "stopped") {
      return {
        ok: false,
        reason: `task_stopped:${lastTaskCompletion.detail || lastTaskCompletion.payload?.summary || "unknown"}`,
        result: successfulResult ?? lastResult,
        events,
      };
    }

    if (successfulResult) {
      const taskCompleted = lastTaskCompletion?.status === "completed";
      const agentIdle = lastStatus?.status === "IDLE";

      if (taskCompleted) {
        return { ok: true, reason: "done", result: successfulResult, events };
      }

      if (agentIdle) {
        // Agent is idle and the DOM success check passed —
        // treat as success even without explicit TASK_COMPLETION event.
        return {
          ok: true,
          reason: "idle_with_successful_result",
          result: successfulResult,
          events,
        };
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

    if (lastTaskCompletion?.status === "completed" && !successfulResult) {
      completedPollsRemaining ??= COMPLETED_GRACE_POLLS;
      completedPollsRemaining -= 1;
      if (completedPollsRemaining <= 0) {
        return {
          ok: false,
          reason: "completed_without_expected_state",
          result: lastResult,
          events,
        };
      }
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
  const finalCompletionState = getLatestTaskCompletionState(events);
  return {
    ok: false,
    reason:
      finalCompletionState === "partial"
        ? "task_partial"
        : finalCompletionState === "stopped"
          ? "task_stopped"
          : "timeout",
    result: successfulResult ?? lastResult,
    events,
  };
}

export const __testOnly = {
  describeTaskCompletionEvent,
  describeTerminalWaitEvent,
  getLatestTaskCompletionEvent,
  getLatestTaskCompletionState,
  getLatestTerminalWaitEvent,
  hasIdleAfterTerminalCompletion,
  isTerminalAgentStatusEvent,
  isTerminalTaskCompletionStatus,
  throwIfTaskAlreadyFinished,
};
