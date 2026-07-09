/**
 * Budget-estimator registry (RFC LP-16 Phase 5 — class-by-responsibility split).
 *
 * Owns the orchestrator's per-workspace BudgetEstimator instances (reset when a
 * task starts, lazily created on demand, dropped when the workspace clears).
 * Extracted verbatim from AgentOrchestrator.
 */

import { BudgetEstimator } from "./budget-estimator";

export class BudgetEstimatorRegistry {
  private estimators = new Map<string, BudgetEstimator>();

  /** Start a fresh estimator for a workspace (task start). */
  reset(workspaceId: string): void {
    this.estimators.set(workspaceId, new BudgetEstimator());
  }

  /** The workspace's estimator, lazily creating one if absent. */
  get(workspaceId: string): BudgetEstimator {
    let estimator = this.estimators.get(workspaceId);
    if (!estimator) {
      estimator = new BudgetEstimator();
      this.estimators.set(workspaceId, estimator);
    }
    return estimator;
  }

  /** Drop a workspace's estimator. */
  clear(workspaceId: string): void {
    this.estimators.delete(workspaceId);
  }
}
