/**
 * Recent-completion tracker (RFC LP-16 Phase 5 — class-by-responsibility split).
 *
 * Owns the orchestrator's per-workspace recent-completion state: a single
 * latest-completion cache (for side-panel resync after a workspace switch) and a
 * short TTL-bounded history (folded into the planner's conversation context).
 * Extracted verbatim from AgentOrchestrator; the orchestrator now composes this
 * instead of holding the two Maps and their access logic inline.
 */

import type { TaskCompletionMessage } from "../../types";

const RECENT_COMPLETION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECENT_COMPLETION_HISTORY = 6;
export const MAX_RECENT_COMPLETION_CONTEXT_CHARS = 1400;
const MAX_RECENT_COMPLETION_LINE_CHARS = 260;

type CompletionEntry = {
  payload: TaskCompletionMessage["payload"];
  timestamp: number;
};

export class RecentCompletionTracker {
  private recentCompletion = new Map<string, CompletionEntry>();
  private recentCompletionHistory = new Map<string, CompletionEntry[]>();

  /** Cache the latest completion + append it to the workspace's history. */
  record(workspaceId: string, payload: TaskCompletionMessage["payload"]): void {
    this.recentCompletion.set(workspaceId, { payload, timestamp: Date.now() });
    if (payload.summary) {
      const history = this.recentCompletionHistory.get(workspaceId) ?? [];
      history.push({ payload, timestamp: Date.now() });
      this.recentCompletionHistory.set(
        workspaceId,
        history.slice(-MAX_RECENT_COMPLETION_HISTORY),
      );
    }
  }

  /** The latest cached completion for a workspace (no freshness filtering). */
  getCached(workspaceId: string): CompletionEntry | undefined {
    return this.recentCompletion.get(workspaceId);
  }

  /** The latest cached completion, only if within the TTL window. */
  getCachedFresh(workspaceId: string): CompletionEntry | undefined {
    const cached = this.recentCompletion.get(workspaceId);
    if (cached && Date.now() - cached.timestamp < RECENT_COMPLETION_TTL_MS) {
      return cached;
    }
    return undefined;
  }

  /** Drop the latest-completion cache for a workspace. */
  clear(workspaceId: string): void {
    this.recentCompletion.delete(workspaceId);
  }

  /** Render the fresh recent-completion history as planner context lines. */
  getContext(workspaceId: string): string {
    const now = Date.now();
    const freshEntries = (this.recentCompletionHistory.get(workspaceId) ?? [])
      .filter((entry) => now - entry.timestamp < RECENT_COMPLETION_TTL_MS)
      .slice(-MAX_RECENT_COMPLETION_HISTORY);
    if (freshEntries.length === 0) {
      this.recentCompletionHistory.delete(workspaceId);
      return "";
    }
    this.recentCompletionHistory.set(workspaceId, freshEntries);
    return freshEntries
      .map((entry, index) => {
        const summary = (entry.payload.summary || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_RECENT_COMPLETION_LINE_CHARS);
        return summary ? `- Assistant result ${index + 1}: ${summary}` : "";
      })
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_RECENT_COMPLETION_CONTEXT_CHARS);
  }
}
