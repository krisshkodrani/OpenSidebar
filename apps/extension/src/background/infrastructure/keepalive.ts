/**
 * Service Worker Keepalive
 *
 * Prevents the service worker from terminating during long-running operations
 * using an active-task heartbeat, with chrome.alarms as a fallback.
 *
 * MV3 service workers terminate after ~30 seconds of inactivity. This module
 * calls an extension API every 20 seconds while work is active. Alarms alone
 * cannot reliably beat the idle deadline in packaged extensions.
 */

import { logger } from "../../utils";
import { isContentScript } from "../../utils/context";
import { chromeSchedulerPort } from "../environment/chrome";

// --- Constants ---

const ALARM_NAME = "opensidebar:keepalive";
const ALARM_PERIOD_MINUTES = 0.5;
const HEARTBEAT_INTERVAL_MS = 20_000;

// --- State ---

let isActive = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// --- Public API ---

/**
 * Starts the active-task heartbeat and fallback alarm.
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

  isActive = true;
  heartbeatTimer = setInterval(() => {
    // Extension API activity resets the worker idle timer, including while a
    // model request is pending and no side panel is open.
    void chrome.runtime.getPlatformInfo().catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  try {
    await chromeSchedulerPort.createAlarm(ALARM_NAME, {
      periodInMinutes: ALARM_PERIOD_MINUTES,
    });
    logger.info("keepalive", "Started keepalive alarm");
  } catch (error) {
    logger.warn("keepalive", "Failed to create alarm", { error });
  }
}

/**
 * Stops the heartbeat and clears the fallback alarm.
 * Call this when the agent loop ends.
 */
export async function stopKeepalive(): Promise<void> {
  // Skip in content scripts - alarms API not available
  if (isContentScript()) {
    return;
  }

  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const wasActive = isActive;
  isActive = false;

  // Always attempt to clear — after a SW restart isActive resets to false
  // but the alarm may still exist in Chrome's alarm registry.
  try {
    await chromeSchedulerPort.clearAlarm(ALARM_NAME);
    if (wasActive) {
      logger.info("keepalive", "Stopped keepalive alarm");
    }
  } catch (error) {
    logger.warn("keepalive", "Failed to clear alarm", { error });
  }
}

/**
 * Handler for chrome.alarms.onAlarm.
 * Simply logs activity to keep the SW alive.
 */
function handleAlarm(alarm: { name: string }): void {
  if (alarm.name === ALARM_NAME) {
    logger.debug("keepalive", "Keepalive ping", { ts: Date.now() });
    // The act of handling this alarm resets the SW termination timer
  }
}

/**
 * Registers the alarm and sidepanel connection listeners.
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

  // A port with no receiving listener immediately disconnects, even when the
  // worker is healthy. Register synchronously alongside the alarm listener.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "sidepanel-keepalive") return;
    port.onDisconnect.addListener(() => {
      // Consume connection errors without treating a closing panel as a crash.
      void chrome.runtime.lastError;
    });
  });
  chromeSchedulerPort.onAlarm(handleAlarm);
  logger.info("keepalive", "Alarm listener registered");
}
