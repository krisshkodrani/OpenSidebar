/**
 * Lane registry (RFC LP-16 Phase 5 — class-by-responsibility split).
 *
 * Owns the orchestrator's two per-workspace lane Maps — the runtime state
 * (queue depth, circuit breakers) and the supervisor state (restart timers) —
 * which are always created, read, and torn down as a pair. Extracted verbatim
 * from AgentOrchestrator; the lazy "initialize on miss" path stays in the
 * orchestrator because it also seeds the worker pools and budget estimator.
 */

import type {
  LaneRuntimeState,
  LaneSupervisorState,
  RuntimeLane,
} from "./lane-types";
import { clearLaneSupervisorTimers } from "./lane-supervisor";

export class LaneRegistry {
  private runtime = new Map<string, Record<RuntimeLane, LaneRuntimeState>>();
  private supervisors = new Map<
    string,
    Record<RuntimeLane, LaneSupervisorState>
  >();

  /** Install a workspace's lane runtime state. */
  setRuntime(
    workspaceId: string,
    state: Record<RuntimeLane, LaneRuntimeState>,
  ): void {
    this.runtime.set(workspaceId, state);
  }

  /** Install a workspace's lane supervisor state. */
  setSupervisors(
    workspaceId: string,
    state: Record<RuntimeLane, LaneSupervisorState>,
  ): void {
    this.supervisors.set(workspaceId, state);
  }

  /** The workspace's lane runtime state, if initialized. */
  getRuntime(
    workspaceId: string,
  ): Record<RuntimeLane, LaneRuntimeState> | undefined {
    return this.runtime.get(workspaceId);
  }

  /** The workspace's lane supervisor state, if initialized. */
  getSupervisors(
    workspaceId: string,
  ): Record<RuntimeLane, LaneSupervisorState> | undefined {
    return this.supervisors.get(workspaceId);
  }

  /** Clear a workspace's supervisor timers and drop both lane maps. */
  clear(workspaceId: string): void {
    clearLaneSupervisorTimers(this.supervisors.get(workspaceId));
    this.supervisors.delete(workspaceId);
    this.runtime.delete(workspaceId);
  }
}
