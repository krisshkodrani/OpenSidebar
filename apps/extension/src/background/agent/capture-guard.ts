/**
 * LP-24 — perception-capture guard + captureVisibleTab quota retry.
 *
 * `withPresenceSuspended` brackets a screenshot so the presence cursor is
 * hidden before pixels are read and restored after — the executor's own VL
 * screenshots must never contain the synthetic cursor (RFC LP-24 §2.2/§6).
 * The suspend round-trip is capped at 60ms and all errors are swallowed: a
 * dead content script can never stall perception.
 *
 * `captureVisibleTabWithQuotaRetry` is the capture funnel extracted from
 * AgentLoop (ratchet offset): one retry after the 2/sec quota error.
 */

import { MessageSource } from "../../types";

const SUSPEND_ROUNDTRIP_CAP_MS = 60;
const CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS = 300;

type CaptureLog = {
  warn(scope: string, message: string, data?: Record<string, unknown>): void;
};

async function sendPresenceMessage(
  tabId: number,
  type: "PRESENCE_SUSPEND" | "PRESENCE_RESUME",
): Promise<void> {
  await chrome.tabs.sendMessage(tabId, {
    type,
    source: MessageSource.BACKGROUND,
    payload: {},
  });
}

/** Suspend the presence overlay, run the capture, always resume. */
export async function withPresenceSuspended<T>(
  tabId: number,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    await Promise.race([
      sendPresenceMessage(tabId, "PRESENCE_SUSPEND"),
      new Promise<void>((resolve) =>
        setTimeout(resolve, SUSPEND_ROUNDTRIP_CAP_MS),
      ),
    ]);
  } catch {
    /* no content script on this page — nothing to hide */
  }
  try {
    return await fn();
  } finally {
    sendPresenceMessage(tabId, "PRESENCE_RESUME").catch(() => {});
  }
}

/** captureVisibleTab with a single retry after the per-second quota error. */
export async function captureVisibleTabWithQuotaRetry(
  windowId: number,
  options: { format?: "jpeg" | "png"; quality?: number },
  log: CaptureLog,
): Promise<string> {
  try {
    return (await chrome.tabs.captureVisibleTab(
      windowId,
      options as chrome.tabs.CaptureVisibleTabOptions,
    )) as unknown as string;
  } catch (error: unknown) {
    const message = String((error as { message?: unknown })?.message || "");
    const isQuotaError =
      /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message) ||
      /\bquota\b/i.test(message);
    if (!isQuotaError) throw error;

    log.warn("agent", "captureVisibleTab quota hit, retrying once", {
      error: message,
      delayMs: CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS,
    });
    await new Promise((resolve) =>
      setTimeout(resolve, CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS),
    );
    return (await chrome.tabs.captureVisibleTab(
      windowId,
      options as chrome.tabs.CaptureVisibleTabOptions,
    )) as unknown as string;
  }
}
