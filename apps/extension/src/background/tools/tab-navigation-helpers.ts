/**
 * Tab-listing and navigation-boundary helpers (RFC LP-16 Phase 4). Formats
 * controllable tabs, resolves allowed navigation origins, enforces the
 * navigation boundary, and waits for tab URL changes. Verbatim movement from
 * tools/index.ts.
 */

import { UserSettings } from "../../types";
import { chromePersistencePort } from "../environment/chrome";
import { isUsableTabUrl } from "../infrastructure/tab-resolution";
import { getTabUrl } from "./helpers";
import {
  getDelegatedNavigationPolicyForTab,
  isUrlAllowedByDelegatedPolicy,
} from "../infrastructure/delegated-navigation-policy";

export function formatControllableTabLines(tabs: chrome.tabs.Tab[]): string[] {
  const controllableTabs = tabs.filter((tab) => isUsableTabUrl(getTabUrl(tab)));
  const omittedCount = tabs.length - controllableTabs.length;

  if (controllableTabs.length === 0) {
    return omittedCount > 0
      ? [
          "No controllable web tabs are open. Internal browser or extension tabs were omitted because page tools cannot run there.",
        ]
      : ["No open tabs."];
  }

  const lines = controllableTabs.map(
    (tab) =>
      `Tab ${tab.id}: "${tab.title || "(untitled)"}" - ${getTabUrl(tab) || "about:blank"}${tab.active ? " [active]" : ""}`,
  );
  if (omittedCount > 0) {
    lines.push(
      `Note: ${omittedCount} internal browser/extension tab${omittedCount === 1 ? "" : "s"} omitted because page tools cannot run there.`,
    );
  }
  return lines;
}

export async function getAllowedNavigationOrigins(tabId?: number): Promise<string[]> {
  if (tabId !== undefined) {
    const delegated = await getDelegatedNavigationPolicyForTab(tabId);
    if (delegated) return delegated.allowedDomains;
  }
  try {
    const stored = await chromePersistencePort.sync.get("userSettings");
    const settings = (stored.userSettings ?? {}) as UserSettings;
    return Array.isArray(settings.allowedNavigationOrigins)
      ? settings.allowedNavigationOrigins.filter(
          (origin): origin is string => typeof origin === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export async function isNavigationTargetAllowed(
  tabId: number,
  target: string,
): Promise<{ allowed: boolean; boundary: string[] }> {
  const delegated = await getDelegatedNavigationPolicyForTab(tabId);
  if (delegated) {
    return {
      allowed: isUrlAllowedByDelegatedPolicy(target, delegated),
      boundary: delegated.allowedDomains,
    };
  }
  const allowedOrigins = await getAllowedNavigationOrigins();
  if (allowedOrigins.length === 0) {
    return { allowed: true, boundary: [] };
  }
  const targetOrigin = normalizeOrigin(target);
  const normalizedAllowed = allowedOrigins
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin));
  return {
    allowed:
      targetOrigin !== null && normalizedAllowed.includes(targetOrigin),
    boundary:
      normalizedAllowed.length > 0 ? normalizedAllowed : allowedOrigins,
  };
}

export function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function navigationBoundaryError(
  target: string,
  allowedOrigins: string[],
): string {
  return (
    `Error: External navigation blocked for this task. Target ${target} is outside ` +
    `the allowed origin${allowedOrigins.length === 1 ? "" : "s"}: ${allowedOrigins.join(", ")}. ` +
    "Stay in the current application and use in-page navigation, application search, or a direct URL on the allowed origin."
  );
}

export async function waitForTabUrlChange(
  tabId: number,
  previousUrl: string | undefined,
  timeoutMs = 2500,
): Promise<string | null> {
  const isTransientUrl = (url: string): boolean =>
    !url || url === "about:blank" || url.startsWith("chrome://newtab");

  const startedAt = Date.now();
  let fallbackUrl: string | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab.url || "";
      if (currentUrl && currentUrl !== (previousUrl || "")) {
        if (!isTransientUrl(currentUrl)) {
          return currentUrl;
        }
        fallbackUrl = currentUrl;
      }
    } catch {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return fallbackUrl;
}

export async function tryInPageHistoryBack(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as any,
    func: () => {
      window.history.back();
    },
  });
}
