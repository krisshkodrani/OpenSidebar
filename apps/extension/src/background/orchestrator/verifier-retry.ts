import { logger } from "../../utils";
import type { LoopResult } from "../agent/loop-types";
import { MAX_HANDOFF_DEPTH } from "./handoff";
import { appendRecentSideEffects } from "./node-heuristics";
import { decideRetryPolicy } from "./retry-policy";
import { appendHandoffArtifact } from "./task-messaging";
import type { OrchestratorTask, TaskNode } from "./types";
import { deriveSuggestedApproach } from "./utils";
import type { NodeVerificationResult } from "./verifier";

export function applyVerifierRetry(input: {
  task: OrchestratorTask;
  node: TaskNode;
  result: LoopResult;
  verification: NodeVerificationResult;
  verificationConfidence: number;
  driftDetected: boolean;
  staleSignalCount: number;
  emitTrace: (type: string, data: Record<string, unknown>) => void;
}): void {
  const {
    task,
    node,
    result,
    verification,
    verificationConfidence,
    driftDetected,
    staleSignalCount,
    emitTrace,
  } = input;
  const retryDecision = decideRetryPolicy(
    {
      source: "verifier",
      reason: verification.reason,
      confidence: verificationConfidence,
      failureType: verification.failureType,
      driftDetected,
      staleSignalCount,
    },
    node.retries,
  );

  appendHandoffArtifact(node, {
    role: "verifier",
    phase:
      verification.decision === "reroute"
        ? "verifier_reroute"
        : "verifier_retry",
    note:
      verification.decision === "reroute" && verification.rerouteObjective
        ? `${verification.reason} Reroute: ${verification.rerouteObjective}`
        : `${verification.reason} (${retryDecision.rationale})`,
  });

  if (retryDecision.shouldRetry) {
    node.reflexionLog.push({
      attempt: node.retries + 1,
      executorSummary: result.summary || "No executor summary.",
      verifierDecision:
        verification.decision === "reroute" ? "reroute" : "retry",
      verifierReason: verification.reason,
      failureType: verification.failureType,
      confidence: verification.confidence,
      suggestedApproach: deriveSuggestedApproach(verification),
      timestamp: Date.now(),
    });
    emitTrace("reflexion_recorded", {
      nodeId: node.id,
      attempt: node.retries + 1,
      verifierDecision:
        verification.decision === "reroute" ? "reroute" : "retry",
      failureType: verification.failureType,
      confidence: verification.confidence,
      reflexionCount: node.reflexionLog.length,
    });
    task.plannerReflexionLog.push({
      nodeId: node.id,
      verifierDecision:
        verification.decision === "reroute" ? "reroute" : "retry",
      failureType: verification.failureType,
      executorSummary: result.summary || "No executor summary.",
      plannerLesson: "",
      timestamp: Date.now(),
    });
    emitTrace("cross_role_reflexion", {
      nodeId: node.id,
      verifierDecision:
        verification.decision === "reroute" ? "reroute" : "retry",
    });
    node.status = "pending";
    node.retries += 1;
    node.error = appendRecentSideEffects(
      verification.reason,
      result.sideEffectsLog,
    );
    if (verification.decision === "reroute" && verification.rerouteObjective) {
      node.description = verification.rerouteObjective;
      if (node.handoffDepth >= MAX_HANDOFF_DEPTH) {
        logger.warn(
          "orchestrator",
          "Reroute depth limit reached, falling back to retry",
          {
            taskId: task.id,
            nodeId: node.id,
            handoffDepth: node.handoffDepth,
            maxHandoffDepth: MAX_HANDOFF_DEPTH,
          },
        );
      }
    }
  } else {
    node.status = "failed";
    node.error = appendRecentSideEffects(
      `Verifier ${verification.decision}: ${verification.reason} (${retryDecision.rationale})`,
      result.sideEffectsLog,
    );
  }
}
