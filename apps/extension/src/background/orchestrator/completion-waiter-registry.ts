/**
 * Completion-waiter registry (RFC LP-16 Phase 5 — class-by-responsibility split).
 *
 * Owns the orchestrator's per-workspace set of one-shot completion listeners
 * (used by waitForTaskCompletion). Extracted verbatim from AgentOrchestrator;
 * encapsulates the "remove listener, drop the set when empty" cleanup that was
 * duplicated across the resolve and timeout paths.
 */

import type { TaskCompletionMessage } from "../../types";

type CompletionListener = (payload: TaskCompletionMessage["payload"]) => void;

export class CompletionWaiterRegistry {
  private waiters = new Map<string, Set<CompletionListener>>();

  /** Register a one-shot listener for a workspace's next completion. */
  add(workspaceId: string, listener: CompletionListener): void {
    const listeners = this.waiters.get(workspaceId) ?? new Set();
    listeners.add(listener);
    this.waiters.set(workspaceId, listeners);
  }

  /** Remove a listener; drop the workspace's set once it is empty. */
  remove(workspaceId: string, listener: CompletionListener): void {
    const listeners = this.waiters.get(workspaceId);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) {
      this.waiters.delete(workspaceId);
    }
  }

  /** Resolve every waiter for a workspace with the payload, then clear them. */
  resolveAll(
    workspaceId: string,
    payload: TaskCompletionMessage["payload"],
  ): void {
    const listeners = this.waiters.get(workspaceId);
    if (!listeners) return;
    for (const resolve of listeners) resolve(payload);
    this.waiters.delete(workspaceId);
  }
}
