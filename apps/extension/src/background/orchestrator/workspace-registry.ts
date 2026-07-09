/**
 * Workspace registry (RFC LP-16 Phase 5 — class-by-responsibility split).
 *
 * A thin per-workspace value store used for the orchestrator's two central
 * lifecycle Maps: the active task per workspace and the worker/lane pools per
 * workspace. Only the *storage* is encapsulated here — the scheduling, reroute,
 * and drain logic that reads and mutates these entries stays in
 * AgentOrchestrator. The method names deliberately mirror Map's so existing
 * call sites are unchanged; extracted verbatim.
 */

export class WorkspaceRegistry<V> {
  private byWorkspace = new Map<string, V>();

  get(workspaceId: string): V | undefined {
    return this.byWorkspace.get(workspaceId);
  }

  set(workspaceId: string, value: V): void {
    this.byWorkspace.set(workspaceId, value);
  }

  delete(workspaceId: string): void {
    this.byWorkspace.delete(workspaceId);
  }

  has(workspaceId: string): boolean {
    return this.byWorkspace.has(workspaceId);
  }

  keys(): IterableIterator<string> {
    return this.byWorkspace.keys();
  }

  values(): IterableIterator<V> {
    return this.byWorkspace.values();
  }

  get size(): number {
    return this.byWorkspace.size;
  }
}
