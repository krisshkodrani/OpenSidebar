/**
 * Pending-feedback queue (RFC LP-16 Phase 5 — class-by-responsibility split).
 *
 * Owns the orchestrator's per-workspace queue of user feedback that arrived
 * while no executor was active, so it can be drained into the loop once a worker
 * picks the workspace back up (and persisted/restored across checkpoints).
 * Extracted verbatim from AgentOrchestrator.
 */

export class PendingFeedbackQueue {
  private queues = new Map<string, string[]>();

  /** Append feedback for a workspace; returns the resulting queue length. */
  enqueue(workspaceId: string, text: string): number {
    const queue = this.queues.get(workspaceId) ?? [];
    queue.push(text);
    this.queues.set(workspaceId, queue);
    return queue.length;
  }

  /** The queued feedback for a workspace, if any (without clearing it). */
  peek(workspaceId: string): string[] | undefined {
    return this.queues.get(workspaceId);
  }

  /** Replace a workspace's queue from a checkpoint (clears when empty). */
  restore(workspaceId: string, pending: string[] | undefined): void {
    if (pending?.length) {
      this.queues.set(workspaceId, [...pending]);
    } else {
      this.queues.delete(workspaceId);
    }
  }

  /** Drop a workspace's queued feedback. */
  clear(workspaceId: string): void {
    this.queues.delete(workspaceId);
  }
}
