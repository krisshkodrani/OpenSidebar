import type { ForwardedApprovalDryRun } from "@shared-types/browser-bridge";
import { AgentStatus, type AgentStep, type ToolName } from "../../types";
import type { RuntimeMessage } from "@shared-types/messages";
import type { SessionScopedLogger } from "../../utils";
import type { TraceRecorder } from "./trace";
import type { PendingUserInteraction } from "./loop-types";
import {
  approvalRequestMessage,
  clarificationRequestMessage,
} from "./agent-broadcast";
import {
  approvalRequestStep,
  clarificationRequestStep,
} from "./agent-interaction-steps";
import {
  getMatchingApprovalInteraction,
  getMatchingClarificationInteraction,
} from "./loop-queries";
import { PendingInteractionYield } from "./start-result";

const CLARIFICATION_TIMEOUT_MS = 120_000;

export interface InteractionHost {
  readonly resumeInteraction: PendingUserInteraction | null;
  clearResumeInteraction(): void;
  readonly nodeId: string | null;
  readonly approvalTimeoutMs: number;
  readonly turnCount: number;
  readonly log: Pick<SessionScopedLogger, "info" | "warn">;
  readonly traceRecorder: TraceRecorder | null;
  statusHandler(status: AgentStatus, detail: string): void;
  stepHandler(step: AgentStep, update: boolean): void;
  readonly workspaceId: string | null;
  readonly workerId: string | null;
  readonly bypassApprovals: boolean;
  dispatchMessage(message: RuntimeMessage): Promise<unknown>;
}

export async function requestApproval(
  host: InteractionHost,
  toolName: ToolName,
  args: Record<string, unknown>,
  context: string,
  dryRun?: ForwardedApprovalDryRun,
): Promise<boolean> {
  const interaction = getMatchingApprovalInteraction(
    { resumeInteraction: host.resumeInteraction },
    toolName,
    args,
    context,
  ) ?? {
    kind: "approval" as const,
    nodeId: host.nodeId,
    requestedAt: Date.now(),
    approvalId: crypto.randomUUID(),
    toolName,
    args,
    context,
    timeoutMs: host.approvalTimeoutMs,
    ...(dryRun ? { dryRun } : {}),
  };
  const remainingTimeoutMs = Math.max(
    0,
    interaction.timeoutMs - (Date.now() - interaction.requestedAt),
  );

  if (remainingTimeoutMs <= 0) {
    host.clearResumeInteraction();
    host.log.warn("policy", "Approval timed out before resume", {
      approvalId: interaction.approvalId,
      turn: host.turnCount,
      toolName,
      workspaceId: host.workspaceId,
      workerId: host.workerId,
    });
    host.traceRecorder?.recordEvent("approval", {
      approvalId: interaction.approvalId,
      stage: "settled",
      turn: host.turnCount,
      toolName,
      outcome: "timeout",
      approved: false,
    });
    return false;
  }

  if (typeof interaction.approved === "boolean") {
    host.clearResumeInteraction();
    host.log.info("policy", "Approval decision restored", {
      approvalId: interaction.approvalId,
      turn: host.turnCount,
      toolName,
      approved: interaction.approved,
      workspaceId: host.workspaceId,
      workerId: host.workerId,
    });
    host.traceRecorder?.recordEvent("approval", {
      approvalId: interaction.approvalId,
      stage: "settled",
      turn: host.turnCount,
      toolName,
      outcome: interaction.approved ? "approved" : "rejected",
      approved: interaction.approved,
    });
    return interaction.approved;
  }

  host.statusHandler(AgentStatus.PAUSED, "Waiting for approval...");
  const approvalStep = approvalRequestStep({
    id: crypto.randomUUID(),
    context,
    timestamp: Date.now(),
  });
  host.stepHandler(approvalStep, false);
  host.log.info("policy", "Approval request yielded to orchestrator", {
    approvalId: interaction.approvalId,
    turn: host.turnCount,
    toolName,
    context,
    timeoutMs: interaction.timeoutMs,
    remainingTimeoutMs,
    workspaceId: host.workspaceId,
    workerId: host.workerId,
  });
  host.traceRecorder?.recordEvent("approval", {
    approvalId: interaction.approvalId,
    stage: "requested",
    turn: host.turnCount,
    toolName,
    context,
    timeoutMs: interaction.timeoutMs,
    bypassApprovals: host.bypassApprovals,
  });
  host.dispatchMessage(
    approvalRequestMessage({
      approvalId: interaction.approvalId,
      toolName,
      toolArgs: args,
      context,
      timeoutMs: remainingTimeoutMs,
      totalTimeoutMs: interaction.timeoutMs,
      workspaceId: host.workspaceId,
      requestId: crypto.randomUUID(),
    }),
  )
    .catch((error: any) => {
      host.log.warn("policy", "Approval request dispatch failed", {
        approvalId: interaction.approvalId,
        turn: host.turnCount,
        toolName,
        error: error?.message ?? String(error),
        workspaceId: host.workspaceId,
        workerId: host.workerId,
      });
    });
  throw new PendingInteractionYield(interaction);
}

export async function requestClarification(
  host: InteractionHost,
  question: string,
  suggestions?: string[],
): Promise<string> {
  const interaction = getMatchingClarificationInteraction(
    { resumeInteraction: host.resumeInteraction },
    question,
    suggestions,
  ) ?? {
    kind: "clarification" as const,
    nodeId: host.nodeId,
    requestedAt: Date.now(),
    clarificationId: crypto.randomUUID(),
    question,
    ...(suggestions ? { suggestions } : {}),
    timeoutMs: CLARIFICATION_TIMEOUT_MS,
  };
  const remainingTimeoutMs = Math.max(
    0,
    interaction.timeoutMs - (Date.now() - interaction.requestedAt),
  );

  if (remainingTimeoutMs <= 0) {
    host.clearResumeInteraction();
    host.log.warn("agent", "Clarification timed out before resume", {
      clarificationId: interaction.clarificationId,
      turn: host.turnCount,
    });
    host.traceRecorder?.recordEvent("clarification", {
      clarificationId: interaction.clarificationId,
      stage: "settled",
      turn: host.turnCount,
      outcome: "timeout",
    });
    return "No response from user.";
  }

  if (typeof interaction.answer === "string") {
    host.clearResumeInteraction();
    host.log.info("agent", "Clarification response restored", {
      clarificationId: interaction.clarificationId,
      turn: host.turnCount,
    });
    host.traceRecorder?.recordEvent("clarification", {
      clarificationId: interaction.clarificationId,
      stage: "settled",
      turn: host.turnCount,
      outcome: "answered",
    });
    return interaction.answer;
  }

  host.statusHandler(AgentStatus.PAUSED, "Waiting for user clarification...");
  const clarifyStep = clarificationRequestStep({
    id: crypto.randomUUID(),
    question,
    timestamp: Date.now(),
  });
  host.stepHandler(clarifyStep, false);

  host.log.info("agent", "Clarification yielded to orchestrator", {
    clarificationId: interaction.clarificationId,
    turn: host.turnCount,
    question: question.slice(0, 200),
    timeoutMs: interaction.timeoutMs,
    remainingTimeoutMs,
  });
  host.traceRecorder?.recordEvent("clarification", {
    clarificationId: interaction.clarificationId,
    stage: "requested",
    turn: host.turnCount,
    question,
  });
  host.dispatchMessage(
    clarificationRequestMessage({
      clarificationId: interaction.clarificationId,
      question,
      suggestions,
      timeoutMs: remainingTimeoutMs,
      workspaceId: host.workspaceId,
      requestId: crypto.randomUUID(),
    }),
  )
    .catch((error: any) => {
      host.log.warn("agent", "Clarification request dispatch failed", {
        clarificationId: interaction.clarificationId,
        error: error?.message ?? String(error),
      });
    });
  throw new PendingInteractionYield(interaction);
}
