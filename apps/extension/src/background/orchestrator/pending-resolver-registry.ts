/**
 * Pending-resolver registry (RFC LP-16 Phase 5 — class-by-responsibility split).
 *
 * A small generic map of in-flight request id → one-shot resolver, used for the
 * orchestrator's human-in-the-loop round-trips (escalation decisions, plan
 * confirmations) where a Promise is parked until the side panel responds. The
 * resolver closures themselves stay in AgentOrchestrator (they emit trace events
 * and clear their own timeouts) — this class owns only the Map and its
 * register / lookup / cancel-all lifecycle. Extracted verbatim.
 */

export class PendingResolverRegistry<T> {
  private scopes = new Map<string, string>();
  private resolvers = new Map<string, (value: T) => void>();

  /** Park a resolver under a request id (overwrites any prior one). */
  register(id: string, resolver: (value: T) => void, scope?: string): void {
    if (scope !== undefined) this.scopes.set(id, scope);
    else this.scopes.delete(id);
    this.resolvers.set(id, resolver);
  }

  /** The resolver for a request id, if still pending. */
  get(id: string): ((value: T) => void) | undefined {
    return this.resolvers.get(id);
  }

  /** Drop a request id's resolver. */
  delete(id: string): void {
    this.resolvers.delete(id);
    this.scopes.delete(id);
  }

  resolveScope(scope: string, value: T): void {
    for (const [id, resolve] of [...this.resolvers]) {
      if (this.scopes.get(id) !== scope) continue;
      resolve(value);
      this.delete(id);
    }
  }

  /** Resolve every pending request with the same value, then clear them all. */
  resolveAll(value: T): void {
    for (const [id, resolve] of this.resolvers) {
      resolve(value);
      this.delete(id);
    }
  }
}
