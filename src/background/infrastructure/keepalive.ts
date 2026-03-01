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

// --- Constants ---

const ALARM_NAME = "qsidebar:keepalive";
const ALARM_PERIOD_MINUTES = 0.4; // ~24 seconds (minimum is 0.5 in production, but 0.4 works in dev)

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

  if (!isActive) {
    return;
  }

  try {
    await chrome.alarms.clear(ALARM_NAME);
    isActive = false;
    logger.info("keepalive", "Stopped keepalive alarm");
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
