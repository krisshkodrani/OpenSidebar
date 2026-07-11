/**
 * Surfacing of page-opened tabs to the executor model.
 *
 * When a click hits a target=_blank link (or the page calls window.open), the
 * new tab is created OUTSIDE the loop's view: the post-tool snapshot still
 * shows the old tab, the action-effect tracker scores the click as a no-op,
 * and the model is told its click "did nothing" — so it re-navigates in place
 * and destroys its own work, while orphan duplicate tabs accumulate. (Observed
 * as the dominant failure mode of long multi-tab arena runs, 2026-07-11.)
 *
 * WorkspaceManager adopts such tabs via chrome.tabs.onCreated (openerTabId ∈
 * workspace) and queues a SpawnedTabRecord. The completion phase calls
 * surfaceSpawnedTabs() each turn to drain that queue into (a) an explicit
 * model-visible note naming the new tab and how to reach it, and (b) the
 * context's spawned-tab latch, which unlocks the tab-management tool gate.
 * refreshOpenTabInventory() keeps the standing "## Open Tabs" prompt section
 * current so the model can always tell which tab its snapshot belongs to.
 */

import { workspaceManager } from "../workspaces/manager";

export interface SpawnedTabSurfacingHost {
  readonly turnCount: number;
  readonly context: {
    addMessage(message: { role: "user"; content: string }): void;
    noteSpawnedTabs(): void;
    setOpenTabs(
      tabs: Array<{ tabId: number; title: string; url: string }>,
      currentTabId: number | null,
    ): void;
  };
  readonly log: {
    info(area: string, message: string, data?: Record<string, unknown>): void;
  };
  readonly traceRecorder: {
    recordEvent(name: string, data?: Record<string, unknown>): void;
  } | null;
}

/**
 * Drain page-opened tabs adopted into the workspace and tell the model about
 * them. Returns the number of tabs surfaced this turn — a non-zero count means
 * the "last action had zero effect" verdict is wrong and must be suppressed.
 */
export async function surfaceSpawnedTabs(
  host: SpawnedTabSurfacingHost,
  workspaceId: string | null,
): Promise<number> {
  if (!workspaceId || workspaceId === "default") return 0;
  const spawned = workspaceManager.drainSpawnedTabs(workspaceId);
  if (spawned.length === 0) return 0;

  // Re-resolve each tab: onCreated often fires before the URL commits, and a
  // tab may already be gone again (e.g. instantly closed popup).
  const lines: string[] = [];
  const surfacedTabIds: number[] = [];
  for (const record of spawned) {
    try {
      const tab = await chrome.tabs.get(record.tabId);
      const url = tab.url || tab.pendingUrl || record.url || "about:blank";
      const title = tab.title ? `"${tab.title}" — ` : "";
      lines.push(`Tab ${record.tabId}: ${title}${url}`);
      surfacedTabIds.push(record.tabId);
    } catch {
      // Tab closed before we could describe it — nothing to surface.
    }
  }
  if (lines.length === 0) return 0;

  host.context.noteSpawnedTabs();
  host.context.addMessage({
    role: "user",
    content:
      `Your last action opened ${lines.length === 1 ? "a NEW browser tab" : `${lines.length} NEW browser tabs`} — that is why the current page looks unchanged:\n` +
      `${lines.join("\n")}\n` +
      `The new tab is part of your workspace. Call switch_tab({"tabId": N}) to work in it. ` +
      `Do not navigate the current tab to that URL — the tab is already open, and navigating away discards any form values on the current page.`,
  });
  host.traceRecorder?.recordEvent("page_opened_tab_adopted", {
    turn: host.turnCount,
    tabIds: surfacedTabIds,
  });
  host.log.info("agent", "Surfaced page-opened tabs to model", {
    turn: host.turnCount,
    tabIds: surfacedTabIds,
  });
  return lines.length;
}

/**
 * Refresh the context's open-tab inventory (the "## Open Tabs" prompt
 * section). Cheap no-op for single-tab workspaces — the section only renders
 * at 2+ tabs.
 */
export async function refreshOpenTabInventory(
  host: SpawnedTabSurfacingHost,
  workspaceTabIds: number[] | null,
  currentTabId: number | null,
): Promise<void> {
  if (!workspaceTabIds || workspaceTabIds.length < 2) {
    host.context.setOpenTabs([], currentTabId);
    return;
  }
  const tabs: Array<{ tabId: number; title: string; url: string }> = [];
  for (const tabId of workspaceTabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      tabs.push({
        tabId,
        title: tab.title || "",
        url: tab.url || tab.pendingUrl || "",
      });
    } catch {
      // Tab closed externally; skip.
    }
  }
  host.context.setOpenTabs(tabs, currentTabId);
}
