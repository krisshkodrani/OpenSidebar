import { logger } from "../../utils";
import type { LoopResult } from "../agent/loop-types";
import { createRerouteNode, MAX_HANDOFF_DEPTH } from "./handoff";
import { appendRecentSideEffects } from "./node-heuristics";
import { maybeRecordReviewedItem, recordCompletedPhase } from "./runtime-policy";
import { appendHandoffArtifact } from "./task-messaging";
import type { OrchestratorTask, TaskNode } from "./types";
import { recordVerifierAcceptedResult } from "./verifier-accepted-results";
import type { NodeVerificationResult } from "./verifier";

export function applyImmediateVerifierOutcome(input: {
  task: OrchestratorTask;
  node: TaskNode;
  result: LoopResult;
  verification: NodeVerificationResult;
  compactResultSummary: string;
  currentTitle?: string;
  currentUrl?: string;
  recordExtractedFacts: () => void;
  emitCompletionScope: () => void;
}): "accepted" | "rerouted" | "retry" | "failed" {
  const {
    task, node, result, verification, compactResultSummary,
    currentTitle, currentUrl, recordExtractedFacts, emitCompletionScope,
  } = input;
  if (verification.decision === "accept") {
    appendHandoffArtifact(node, {
      role: "verifier",
      phase: "verifier_accept",
      note: verification.reason,
    });
    node.status = "completed";
    node.result = compactResultSummary;
    node.userFacingResult = result.summary;
    recordVerifierAcceptedResult(task, node, result.summary);
    recordCompletedPhase(task, node.description);
    maybeRecordReviewedItem(task, node);
    recordExtractedFacts();
    emitCompletionScope();
    return "accepted";
  }
  if (
    verification.decision === "reroute" &&
    verification.rerouteObjective &&
    task.status === "running" &&
    node.handoffDepth < MAX_HANDOFF_DEPTH
  ) {
    appendHandoffArtifact(node, {
      role: "verifier",
      phase: "verifier_reroute",
      note: `${verification.reason} Reroute: ${verification.rerouteObjective}`,
    });
    const reroutedNode = createRerouteNode(
      node,
      verification.rerouteObjective,
      verification.reason,
      {
        pageTitle: currentTitle,
        pageUrl: currentUrl,
        enabledSkillPackIds: task.enabledSkillPackIds,
      },
    );
    node.status = "completed";
    node.result = `Handed off to ${reroutedNode.id}: ${verification.reason}`;
    task.nodes.push(reroutedNode);

    logger.info("orchestrator", "Verifier handoff created reroute node", {
      taskId: task.id,
      fromNodeId: node.id,
      toNodeId: reroutedNode.id,
      handoffDepth: reroutedNode.handoffDepth,
      rerouteObjective: verification.rerouteObjective,
    });
    return "rerouted";
  }
  if (task.status === "running") return "retry";

  appendHandoffArtifact(node, {
    role: "verifier",
    phase:
      verification.decision === "reroute"
        ? "verifier_reroute"
        : "verifier_retry",
    note: verification.reason,
  });
  node.status = "failed";
  node.error = appendRecentSideEffects(
    `Verifier ${verification.decision}: ${verification.reason}`,
    result.sideEffectsLog,
  );
  return "failed";
}
