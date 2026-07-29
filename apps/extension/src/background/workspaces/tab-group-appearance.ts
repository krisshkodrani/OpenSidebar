/**
 * Dynamic Chrome Tab Group appearance — title and color tied to agent lifecycle.
 */

import { AgentStatus } from "../../types/enums";
import { workspaceManager } from "./manager";

type ColorEnum = chrome.tabGroups.ColorEnum;

const appearanceQueues = new Map<string, Promise<void>>();

function enqueueAppearanceUpdate(
  workspaceId: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = appearanceQueues.get(workspaceId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      if (appearanceQueues.get(workspaceId) === current) {
        appearanceQueues.delete(workspaceId);
      }
    });
  appearanceQueues.set(workspaceId, current);
  return current;
}

/** Truncate a user query to fit in a Chrome tab group title. */
export function truncateTaskTitle(query: string, maxLen = 30): string {
  const oneLine = query.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  if (oneLine.length <= maxLen) return oneLine;
  const cut = oneLine.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  const boundary = lastSpace > maxLen * 0.4 ? lastSpace : maxLen;
  return oneLine.slice(0, boundary) + "...";
}

/** Map agent status (+ optional completion outcome) to a Chrome tab group color. */
export function colorForStatus(
  status: AgentStatus,
  completionStatus?: "completed" | "partial" | "failed" | "stopped",
): ColorEnum {
  switch (status) {
    case AgentStatus.THINKING:
      return "cyan";
    case AgentStatus.ACTING:
    case AgentStatus.WAITING_FOR_PAGE_LOAD:
      return "purple";
    case AgentStatus.PAUSED:
      return "yellow";
    case AgentStatus.ERROR:
      return "red";
    case AgentStatus.IDLE:
      if (completionStatus === "completed") return "green";
      if (completionStatus === "partial") return "orange";
      if (completionStatus === "failed") return "red";
      if (completionStatus === "stopped") return "yellow";
      return "blue";
    default:
      return "blue";
  }
}

/**
 * Update the Chrome tab group title and/or color for a workspace.
 * Fire-and-forget — errors are silently swallowed.
 */
export async function updateTabGroupAppearance(
  workspaceId: string,
  opts: {
    title?: string;
    status?: AgentStatus;
    completionStatus?: "completed" | "partial" | "failed" | "stopped";
  },
): Promise<void> {
  return enqueueAppearanceUpdate(workspaceId, async () => {
  try {
    const ws = await workspaceManager.getWorkspaceById(workspaceId);
    if (!ws) return;

      const updates: {
        name?: string;
        baseName?: string;
        color?: ColorEnum;
      } = {};

    if (opts.title !== undefined) {
      if (!ws.baseName) {
          updates.baseName = ws.name;
      }
      const truncated = truncateTaskTitle(opts.title);
      if (truncated) updates.name = truncated;
    }

    if (opts.status !== undefined) {
      updates.color = colorForStatus(opts.status, opts.completionStatus);
    }

      if (
        updates.name !== undefined ||
        updates.baseName !== undefined ||
        updates.color !== undefined
      ) {
      await workspaceManager.updateWorkspace(workspaceId, updates);
    }
  } catch {
      // Appearance is best-effort and must not affect task execution.
  }
  });
}

/**
 * Restore the tab group to its original "OS N" title and blue color.
 */
export async function resetTabGroupAppearance(
  workspaceId: string,
): Promise<void> {
  return enqueueAppearanceUpdate(workspaceId, async () => {
  try {
    const ws = await workspaceManager.getWorkspaceById(workspaceId);
    if (!ws) return;
    const originalName = ws.baseName ?? ws.name;
    await workspaceManager.updateWorkspace(workspaceId, {
      name: originalName,
      color: "blue",
    });
  } catch {
      // Appearance is best-effort and must not affect task execution.
  }
  });
}
