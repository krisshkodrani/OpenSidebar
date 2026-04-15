/**
 * Service Worker Keepalive
 *
 * Prevents the service worker from terminating during long-running operations
 * by using chrome.alarms to keep it alive.
 *
 * MV3 service workers terminate after ~30 seconds of inactivity. This module
 * creates a repeating alarm every 25 seconds to reset the termination timer.
 */

import { logger } from "../../utils";
import { isContentScript } from "../../utils/context";
import { pollPendingTasks } from "./backend-client";

// --- Constants ---

const ALARM_NAME = "opensidebar:keepalive";
const ALARM_PERIOD_MINUTES = 0.45; // ~27s; Chrome rounds to ≥0.5 in prod. Side panel port acts as primary keepalive.

// --- State ---

let isActive = false;

// --- Public API ---

/**
 * Starts the keepalive alarm.
 * Call this when the agent loop begins.
 */
export async function startKeepalive(): Promise<void> {
  // Skip in content scripts - alarms API not available
  if (isContentScript()) {
    logger.debug("keepalive", "Skipping keepalive in content script");
    return;
  }

  if (isActive) {
    logger.debug("keepalive", "Already active, skipping");
    return;
  }

  try {
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: ALARM_PERIOD_MINUTES,
    });
    isActive = true;
    logger.info("keepalive", "Started keepalive alarm");
  } catch (error) {
    logger.warn("keepalive", "Failed to create alarm", { error });
  }
}

/**
 * Stops the keepalive alarm.
 * Call this when the agent loop ends.
 */
export async function stopKeepalive(): Promise<void> {
  // Skip in content scripts - alarms API not available
  if (isContentScript()) {
    return;
  }

  // Always attempt to clear — after a SW restart isActive resets to false
  // but the alarm may still exist in Chrome's alarm registry.
  try {
    await chrome.alarms.clear(ALARM_NAME);
    if (isActive) {
      logger.info("keepalive", "Stopped keepalive alarm");
    }
    isActive = false;
  } catch (error) {
    logger.warn("keepalive", "Failed to clear alarm", { error });
  }
}

/**
 * Handler for chrome.alarms.onAlarm.
 * Simply logs activity to keep the SW alive.
 */
function handleAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === ALARM_NAME) {
    logger.debug("keepalive", "Keepalive ping", { ts: Date.now() });
    // The act of handling this alarm resets the SW termination timer

    // Poll backend for scheduled tasks (silent fail when backend is offline)
    pollPendingTasks()
      .then((tasks) => {
        if (tasks.length > 0) {
          dispatchScheduledTask(tasks[0]);
        }
      })
      .catch(() => {});
  }
}

/**
 * Dispatches a scheduled task from the backend into the orchestrator.
 * Opens a tab (if tabUrl provided), then triggers the orchestrator directly.
 */
async function dispatchScheduledTask(task: {
  id: string;
  query: string;
  tabUrl: string | null;
}): Promise<void> {
  const { markTaskRunning, markTaskCompleted, markTaskFailed } =
    await import("./backend-client-tasks");

  // Mark as running so it won't be picked up again on next poll
  await markTaskRunning(task.id);

  logger.info("keepalive", "Dispatching scheduled task", {
    taskId: task.id,
    query: task.query.slice(0, 80),
    tabUrl: task.tabUrl,
  });

  try {
    // 1. Resolve or create a tab
    let tabId: number;
    if (task.tabUrl) {
      const tab = await chrome.tabs.create({ url: task.tabUrl, active: false });
      tabId = tab.id!;
      // Wait a moment for navigation to start
      await new Promise((r) => setTimeout(r, 1500));
    } else {
      // Use the currently active tab
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        logger.warn("keepalive", "No active tab for scheduled task, skipping", { taskId: task.id });
        await markTaskFailed(task.id, "No active tab available");
        return;
      }
      tabId = activeTab.id;
    }

    // 2. Import orchestrator lazily to avoid circular dependencies
    const {
      startScheduledOrchestratorTask,
      waitForScheduledTaskCompletion,
    } = await import("../orchestrator/scheduled-dispatch");
    const { loadSettings } = await import("../../utils/settings-storage");

    const settings = await loadSettings();
    if (!settings) {
      await markTaskFailed(task.id, "No settings configured");
      return;
    }

    const mode = settings.providerMode ?? "fireworks";
    const activeKey =
      mode === "fireworks" ? settings.fireworksApiKey :
      mode === "openai-groq" ? settings.openaiApiKey :
      settings.openRouterApiKey;

    if (!activeKey) {
      await markTaskFailed(task.id, "No API key configured");
      return;
    }

    // 3. Start the task via orchestrator (same path as USER_CHAT)
    const workspaceId = `scheduled-${task.id.slice(0, 8)}`;

    await startKeepalive();
    await startScheduledOrchestratorTask({
      query: task.query,
      tabId,
      workspaceId,
      settings,
      openRouterApiKey: activeKey || settings.openRouterApiKey,
    });

    const completion = await waitForScheduledTaskCompletion(workspaceId);
    if (!completion) {
      await markTaskFailed(
        task.id,
        "Timed out while waiting for task completion",
      );
      return;
    }

    const resultSummary =
      completion.summary?.trim() ||
      (completion.status === "failed"
        ? "Task failed"
        : "Task completed successfully");

    if (completion.status === "failed") {
      await markTaskFailed(task.id, resultSummary);
      return;
    }

    await markTaskCompleted(task.id, resultSummary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("keepalive", "Scheduled task dispatch failed", {
      taskId: task.id,
      error: message,
    });
    await markTaskFailed(task.id, message).catch(() => {});
  }
}

/**
 * Registers the alarm listener.
 * Must be called at the top level of the service worker.
 */
export function registerAlarmListener(): void {
  // Skip in content scripts - alarms API not available
  if (isContentScript()) {
    logger.debug(
      "keepalive",
      "Skipping alarm listener registration in content script",
    );
    return;
  }

  chrome.alarms.onAlarm.addListener(handleAlarm);
  logger.info("keepalive", "Alarm listener registered");
}
