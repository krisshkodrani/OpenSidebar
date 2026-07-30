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
import { chromeSchedulerPort } from "../environment/chrome";

// --- Constants ---

const ALARM_NAME = "opensidebar:keepalive";
const ALARM_PERIOD_MINUTES = 0.45; // ~27s; Chrome rounds to ≥0.5 in prod. Side panel port acts as primary keepalive.

// --- State ---

let isActive = false;
const activeLeases = new Set<string>();

// --- Public API ---

/**
 * Starts the keepalive alarm.
 * Call this when the agent loop begins.
 */
export async function startKeepalive(lease = "agent"): Promise<void> {
  // Skip in content scripts - alarms API not available
  if (isContentScript()) {
    logger.debug("keepalive", "Skipping keepalive in content script");
    return;
  }

  activeLeases.add(lease);
  if (isActive) {
    logger.debug("keepalive", "Already active, skipping");
    return;
  }

  try {
    await chromeSchedulerPort.createAlarm(ALARM_NAME, {
      periodInMinutes: ALARM_PERIOD_MINUTES,
    });
    isActive = true;
    logger.info("keepalive", "Started keepalive alarm");
  } catch (error) {
    activeLeases.delete(lease);
    logger.warn("keepalive", "Failed to create alarm", { error });
  }
}

/**
 * Stops the keepalive alarm.
 * Call this when the agent loop ends.
 */
export async function stopKeepalive(lease = "agent"): Promise<void> {
  // Skip in content scripts - alarms API not available
  if (isContentScript()) {
    return;
  }

  activeLeases.delete(lease);
  if (activeLeases.size > 0) {
    logger.debug("keepalive", "Keeping alarm for another active lease", {
      leases: [...activeLeases],
    });
    return;
  }

  // Always attempt to clear — after a SW restart isActive resets to false
  // but the alarm may still exist in Chrome's alarm registry.
  try {
    await chromeSchedulerPort.clearAlarm(ALARM_NAME);
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
function handleAlarm(alarm: { name: string }): void {
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

  chromeSchedulerPort.onAlarm(handleAlarm);
  logger.info("keepalive", "Alarm listener registered");
}
