/**
 * Escalation-decision helpers (RFC LP-16 Phase 5). Classify a node
 * verification result's escalation risk and decide whether to escalate.
 * Pure — verbatim movement of Orchestrator helpers.
 */
import type { EscalationRisk } from "../../types";
import type { NodeVerificationResult } from "./verifier";
import { clampConfidence } from "./utils";
import type { OrchestratorTask, TaskNode } from "./types";

export function classifyEscalationRisk(
  verification: NodeVerificationResult,
  node: TaskNode,
): EscalationRisk {
  if (verification.failureType === "blocked") return "critical";
  if (verification.decision === "reroute") return "high";
  if (node.retries >= 2) return "high";
  return "medium";
}

export function shouldEscalateForDecision(
  task: OrchestratorTask,
  node: TaskNode,
  verification: NodeVerificationResult,
): boolean {
  const confidence = clampConfidence(verification.confidence);
  const tokenRatio =
    task.budget.maxTotalTokens > 0
      ? task.sessionMetrics.totalTokens / task.budget.maxTotalTokens
      : 0;
  const costRatio =
    task.budget.maxTotalCostUsd > 0
      ? task.sessionMetrics.totalCost / task.budget.maxTotalCostUsd
      : 0;
  if (verification.failureType === "blocked") return true;
  if (verification.decision !== "accept" && confidence < 0.45) return true;
  if (verification.decision !== "accept" && node.retries >= 2) return true;
  if (
    verification.decision !== "accept" &&
    (tokenRatio >= 0.85 || costRatio >= 0.85)
  ) {
    return true;
  }
  return false;
}
