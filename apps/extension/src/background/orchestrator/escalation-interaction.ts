import {
  type EscalationOption,
  type EscalationOptionId,
  type EscalationPacket,
} from "../../types";
import { logger } from "../../utils";
import { agentNotifications } from "../notifications";
import type { OrchestratorTask, TaskNode } from "./types";
import type { NodeVerificationResult } from "./verifier";
import type { PendingResolverRegistry } from "./pending-resolver-registry";
import type { EscalationDecisionPayload } from "./lane-types";
import { classifyEscalationRisk, shouldEscalateForDecision } from "./escalation-decisions";
import { sendMessage } from "./task-messaging";
import { clampConfidence } from "./utils";
import {
  ESCALATION_MAX_REASON_CHARS,
  ESCALATION_RESPONSE_TIMEOUT_MS,
} from "./runtime-policy";

export interface EscalationInteractionHost {
  persistTaskCheckpoint(task: OrchestratorTask): Promise<void>;
  emitTraceEvent(
    task: OrchestratorTask,
    type: string,
    data: Record<string, unknown>,
    role: "system",
  ): void;
  pendingEscalationResolvers: PendingResolverRegistry<EscalationDecisionPayload>;
}

export function buildEscalationPacket(input: {
  task: OrchestratorTask;
  node: TaskNode;
  verification: NodeVerificationResult;
  snapshot?: { title?: string; url?: string };
}): EscalationPacket {
  const { task, node, verification, snapshot } = input;
  const risk = classifyEscalationRisk(verification, node);
  const reason = verification.reason.slice(0, ESCALATION_MAX_REASON_CHARS);
  const options: EscalationOption[] = [
    {
      id: "approve_continue",
      label: "Continue",
      impact: "Proceed with orchestrator retry policy.",
    },
    {
      id: "reroute_with_option",
      label: "Reroute",
      impact: "Retry with an alternate objective suggested by verifier.",
      rerouteObjective:
        verification.rerouteObjective ||
        `Use an alternate path to complete: ${node.description}`,
    },
    {
      id: "skip_node",
      label: "Skip Node",
      impact: "Mark this node as skipped and continue remaining graph.",
    },
    {
      id: "stop_task",
      label: "Stop Task",
      impact: "Stop task execution immediately.",
    },
  ];
  const recommendedOption: EscalationOptionId =
    risk === "critical"
      ? "stop_task"
      : verification.decision === "reroute"
        ? "reroute_with_option"
        : "approve_continue";

  const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
  return {
    escalationId: crypto.randomUUID(),
    taskId: task.id,
    workspaceId: task.workspaceId,
    nodeId: node.id,
    risk,
    confidence: clampConfidence(verification.confidence),
    reason,
    options,
    recommendedOption,
    snapshotSummary:
      `${snapshot?.title || "Unknown page"} | ${snapshot?.url || "unknown-url"}`.slice(
        0,
        240,
      ),
    lastActions: node.handoffArtifacts
      .slice(-5)
      .map((entry) => `${entry.role}/${entry.phase}: ${entry.note}`)
      .map((entry) => entry.slice(0, 180)),
    budgetState: {
      elapsedMs,
      maxSessionTimeMs: task.budget.maxSessionTimeMs,
      totalTokens: task.sessionMetrics.totalTokens,
      maxTotalTokens: task.budget.maxTotalTokens,
      totalCostUsd: task.sessionMetrics.totalCost,
      maxTotalCostUsd: task.budget.maxTotalCostUsd,
    },
    timeoutMs: ESCALATION_RESPONSE_TIMEOUT_MS,
    timestamp: Date.now(),
  };
}

export async function requestEscalationDecision(
  host: EscalationInteractionHost,
  task: OrchestratorTask,
  packet: EscalationPacket,
): Promise<EscalationDecisionPayload> {
  if (
    task.pendingEscalation?.packet.escalationId === packet.escalationId &&
    task.pendingEscalation.selectedOption
  ) {
    logger.info("orchestrator", "Using checkpointed escalation decision", {
      taskId: task.id,
      nodeId: packet.nodeId,
      escalationId: packet.escalationId,
      optionId: task.pendingEscalation.selectedOption.optionId,
    });
    return task.pendingEscalation.selectedOption;
  }

  task.pendingEscalation = { packet };
  await host.persistTaskCheckpoint(task);

  logger.warn("orchestrator", "Escalation packet created", {
    taskId: task.id,
    nodeId: packet.nodeId,
    escalationId: packet.escalationId,
    risk: packet.risk,
    recommendedOption: packet.recommendedOption,
    reason: packet.reason,
  });
  host.emitTraceEvent(task, "escalation_requested", {
    taskId: task.id,
    nodeId: packet.nodeId,
    escalationId: packet.escalationId,
    risk: packet.risk,
    recommendedOption: packet.recommendedOption,
    reason: packet.reason,
    timeoutMs: packet.timeoutMs,
  }, "system");
  sendMessage({
    type: "ESCALATION_REQUEST",
    workspaceId: task.workspaceId,
    payload: packet,
  });
  void agentNotifications.notifyAttention({
    workspaceId: task.workspaceId,
    taskId: task.id,
    eventId: packet.escalationId,
    tabId: task.rootTabId,
    reason: "Escalation required",
    detail: packet.reason,
  });
  sendMessage({
    type: "AGENT_STEP",
    workspaceId: task.workspaceId,
    payload: {
      step: {
        id: crypto.randomUUID(),
        type: "info",
        label: `Escalation: operator decision requested for ${packet.nodeId.slice(0, 6)}`,
        detail: packet.reason,
        status: "done",
        timestamp: Date.now(),
      },
      update: false,
    },
  });

  return await new Promise<EscalationDecisionPayload>((resolve) => {
    const timeout = setTimeout(() => {
      host.pendingEscalationResolvers.delete(packet.escalationId);
      const fallback: EscalationDecisionPayload = {
        escalationId: packet.escalationId,
        optionId: "stop_task",
      };
      logger.warn("orchestrator", "Escalation decision timed out", {
        taskId: task.id,
        nodeId: packet.nodeId,
        escalationId: packet.escalationId,
        timeoutMs: packet.timeoutMs,
      });
      host.emitTraceEvent(task, "escalation_timeout", {
        taskId: task.id,
        nodeId: packet.nodeId,
        escalationId: packet.escalationId,
        timeoutMs: packet.timeoutMs,
      }, "system");
      resolve(fallback);
    }, packet.timeoutMs);

    host.pendingEscalationResolvers.register(
      packet.escalationId,
      (decision) => {
        clearTimeout(timeout);
        host.pendingEscalationResolvers.delete(packet.escalationId);
        host.emitTraceEvent(task, "escalation_decision_received", {
          taskId: task.id,
          nodeId: packet.nodeId,
          escalationId: packet.escalationId,
          optionId: decision.optionId,
        }, "system");
        resolve(decision);
      },
    );
  });
}

export async function clearPendingEscalation(
  host: Pick<EscalationInteractionHost, "persistTaskCheckpoint">,
  task: OrchestratorTask,
): Promise<void> {
  if (!task.pendingEscalation) return;
  task.pendingEscalation = undefined;
  await host.persistTaskCheckpoint(task);
}

export async function resolveVerifierEscalation(input: {
  host: EscalationInteractionHost;
  task: OrchestratorTask;
  node: TaskNode;
  verification: NodeVerificationResult;
  snapshot?: { title?: string; url?: string };
}): Promise<"continue" | "stop" | "skip"> {
  const { host, task, node, verification, snapshot } = input;
  if (
    task.status !== "running" ||
    !shouldEscalateForDecision(task, node, verification)
  ) {
    return "continue";
  }
  const escalationPacket =
    task.pendingEscalation?.packet.nodeId === node.id
      ? task.pendingEscalation.packet
      : buildEscalationPacket({ task, node, verification, snapshot });
  const escalationDecision = await requestEscalationDecision(
    host,
    task,
    escalationPacket,
  );
  task.pendingEscalation = {
    packet: escalationPacket,
    selectedOption: escalationDecision,
  };
  await host.persistTaskCheckpoint(task);
  logger.info("orchestrator", "Escalation decision received", {
    taskId: task.id,
    nodeId: node.id,
    escalationId: escalationPacket.escalationId,
    optionId: escalationDecision.optionId,
  });

  if (escalationDecision.optionId === "stop_task") {
    task.status = "stopping";
    node.status = "failed";
    node.error = "Stopped by operator escalation decision.";
    await clearPendingEscalation(host, task);
    return "stop";
  }
  if (escalationDecision.optionId === "skip_node") {
    node.status = "skipped";
    node.error = "Skipped by operator escalation decision.";
    await clearPendingEscalation(host, task);
    return "skip";
  }
  if (escalationDecision.optionId === "reroute_with_option") {
    verification.decision = "reroute";
    verification.rerouteObjective =
      escalationDecision.rerouteObjective ||
      escalationPacket.options.find((option) => option.id === "reroute_with_option")
        ?.rerouteObjective ||
      verification.rerouteObjective ||
      `Use an alternate path for: ${node.description}`;
    verification.reason = `Operator reroute decision: ${verification.rerouteObjective}`;
  }
  await clearPendingEscalation(host, task);
  return "continue";
}
