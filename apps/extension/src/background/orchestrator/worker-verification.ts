import { logger } from "../../utils";
import type { LoopResult } from "../agent/loop-types";
import { appendRecentSideEffects } from "./node-heuristics";
import { buildParallelRunState } from "./plan-state";
import { emitVerifierStep } from "./status-emitters";
import { verifyDeterministicCompletionEnvelope } from "./completion-envelope-verification";
import { buildVerifierContext } from "./handoff";
import {
  resolveLaneTopologyFromSettings,
  shouldUseVerifier,
} from "./lane-topology";
import { getLoadedSkillContract } from "./skills";
import type { OrchestratorTask, StructuredEvidence, TaskNode } from "./types";
import {
  programmaticVerify,
  type NodeVerificationInput,
  type NodeVerificationResult,
} from "./verifier";

export async function resolveWorkerVerification(input: {
  task: OrchestratorTask;
  node: TaskNode;
  result: LoopResult;
  executorEvidence: StructuredEvidence[];
  verifierTaskStateBrief: string;
  previousTab?: { url?: string; title?: string } | null;
  readCurrentTab: () => Promise<{ url?: string; title?: string }>;
  verifyNode: (input: NodeVerificationInput) => Promise<NodeVerificationResult>;
  emitTrace: (type: string, data: Record<string, unknown>) => void;
}): Promise<{
  verification: NodeVerificationResult;
  verifierHandoffContext: string;
  currentUrl?: string;
  currentTitle?: string;
}> {
  const {
    task,
    node,
    result,
    executorEvidence,
    verifierTaskStateBrief,
    previousTab,
    readCurrentTab,
    verifyNode,
    emitTrace,
  } = input;
  const verifierHandoffContext = buildVerifierContext(
    node,
    verifierTaskStateBrief,
  );
  // Capture post-execution URL/title for programmatic verification
  let currentUrl: string | undefined;
  let currentTitle: string | undefined;
  try {
    const postTab = await readCurrentTab();
    currentUrl = postTab.url;
    currentTitle = postTab.title;
  } catch {
    // Tab may have closed; proceed without post-execution tab info
  }
  const requiredEvidenceTypes = getLoadedSkillContract(node.selectedSkillId, {
    enabledSkillPackIds: task.enabledSkillPackIds,
  })?.requiredEvidenceTypes;
  const envelopeVerification = result.completionEnvelope
    ? verifyDeterministicCompletionEnvelope(
        result.completionEnvelope,
        node.description,
      )
    : null;
  let verification: NodeVerificationResult;
  if (envelopeVerification) {
    verification = envelopeVerification;
    emitTrace("completion_envelope_verification", {
      nodeId: node.id,
      decision: verification.decision,
      confidence: verification.confidence,
      resultId: result.completionEnvelope?.resultId,
      contractKind: result.completionEnvelope?.contractKind,
      evidenceKeys: result.completionEnvelope?.evidenceKeys ?? [],
      failureType: verification.failureType,
      rerouteObjective: verification.rerouteObjective,
    });
    logger.debug("orchestrator", "Completion envelope verification resolved", {
      taskId: task.id,
      nodeId: node.id,
      decision: verification.decision,
      confidence: verification.confidence,
      contractKind: result.completionEnvelope?.contractKind,
    });
  } else {
    const programmaticResult = programmaticVerify({
      taskQuery: task.query,
      output: result.summary,
      objective: node.description,
      successCriteria: node.successCriteria,
      evidence: executorEvidence,
      requiredEvidenceTypes,
      previousUrl: previousTab?.url,
      currentUrl,
      previousTitle: previousTab?.title,
      currentTitle,
      executorOutcome: result.outcome,
    });
    if (programmaticResult) {
      verification = programmaticResult;
      logger.debug("orchestrator", "Programmatic verification resolved", {
        taskId: task.id,
        nodeId: node.id,
        decision: verification.decision,
        confidence: verification.confidence,
      });
    } else if (
      !shouldUseVerifier(
        resolveLaneTopologyFromSettings({
          laneTopologyMode: task.laneTopologyMode,
        }),
      )
    ) {
      verification = {
        decision: "accept",
        reason: "Verifier skipped by lane topology after executor completion.",
        confidence: 0.7,
      };
    } else {
      verification = await verifyNode({
        taskQuery: task.query,
        objective: node.description,
        successCriteria: node.successCriteria,
        output: result.summary,
        handoffContext: verifierHandoffContext,
        executorOutcome: result.outcome,
        evidence: executorEvidence,
        requiredEvidenceTypes,
        previousUrl: previousTab?.url,
        currentUrl,
        previousTitle: previousTab?.title,
        currentTitle,
      });
    }
  }
  return { verification, verifierHandoffContext, currentUrl, currentTitle };
}

export function recordWorkerVerificationDecision(input: {
  task: OrchestratorTask;
  node: TaskNode;
  workerId: string;
  result: LoopResult;
  verification: NodeVerificationResult;
  verifierHandoffContext: string;
  emitSystemTrace: (type: string, data: Record<string, unknown>) => void;
  emitVerifierTrace: (type: string, data: Record<string, unknown>) => void;
}): { proceed: boolean; confidence: number } {
  const {
    task, node, workerId, result, verification, verifierHandoffContext,
    emitSystemTrace, emitVerifierTrace,
  } = input;
  const confidence =
    typeof verification.confidence === "number" ? verification.confidence : 0.5;
  const failureType = verification.failureType;
  if (node.status !== "running") {
    emitSystemTrace("worker_result_ignored", {
      taskId: task.id,
      nodeId: node.id,
      workerId,
      currentStatus: node.status,
      executorOutcome: result.outcome,
      verifierDecision: verification.decision,
      reason: "node_already_terminal",
      ...buildParallelRunState(task),
    });
    return { proceed: false, confidence };
  }
  if ((task.status as string) === "stopping") {
    emitSystemTrace("worker_result_ignored", {
      taskId: task.id,
      nodeId: node.id,
      workerId,
      currentStatus: node.status,
      executorOutcome: result.outcome,
      verifierDecision: verification.decision,
      reason: "task_stop_requested",
      ...buildParallelRunState(task),
    });
    node.status = "failed";
    node.error = appendRecentSideEffects("Stopped by user", result.sideEffectsLog);
    return { proceed: false, confidence };
  }
  logger.info("orchestrator", "Verifier decision", {
    taskId: task.id,
    nodeId: node.id,
    decision: verification.decision,
    reason: verification.reason,
    confidence,
    failureType,
    rerouteObjective: verification.rerouteObjective,
    handoffContextChars: verifierHandoffContext.length,
  });
  emitVerifierStep(task.workspaceId, node.id, verification.reason);
  emitVerifierTrace("node_verified", {
    nodeId: node.id,
    decision: verification.decision,
    confidence,
    failureType,
    rerouteObjective: verification.rerouteObjective,
    reason: (verification.reason || "").slice(0, 300),
  });
  return { proceed: true, confidence };
}
