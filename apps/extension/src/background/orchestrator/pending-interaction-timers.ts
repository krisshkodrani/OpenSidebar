/**
 * Pending-interaction timers (RFC LP-16 Phase 5 — class-by-responsibility split).
 *
 * Owns the orchestrator's per-workspace timeout handles for pending user
 * interactions, so a pending interaction can auto-resolve if the user never
 * responds. Extracted verbatim from AgentOrchestrator.
 */

export class PendingInteractionTimers {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Track the timeout handle for a workspace's pending interaction. */
  set(workspaceId: string, timer: ReturnType<typeof setTimeout>): void {
    this.timers.set(workspaceId, timer);
  }

  /** Clear + drop a workspace's pending-interaction timer, if any. */
  clear(workspaceId: string): void {
    const timer = this.timers.get(workspaceId);
    if (timer) clearTimeout(timer);
    this.timers.delete(workspaceId);
  }
}
