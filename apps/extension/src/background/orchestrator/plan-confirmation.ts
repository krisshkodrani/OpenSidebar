import { AgentStatus } from "../../types";
import { logger } from "../../utils";
import { agentNotifications } from "../notifications";
import type { OrchestratorTask } from "./types";
import type { PendingResolverRegistry } from "./pending-resolver-registry";
import { sendMessage } from "./task-messaging";
import { sendStatus } from "./status-emitters";

export interface PlanConfirmationResult {
  decision: "approve" | "cancel";
  feedback?: string;
}

export interface PlanConfirmationHost {
  pendingPlanConfirmationResolvers: PendingResolverRegistry<PlanConfirmationResult>;
  emitTraceEvent(
    task: OrchestratorTask,
    type: string,
    data: Record<string, unknown>,
    role: "system",
  ): void;
}

export function resolvePlanConfirmation(
  host: PlanConfirmationHost,
  payload: { confirmationId: string } & PlanConfirmationResult,
): boolean {
  const resolver = host.pendingPlanConfirmationResolvers.get(
    payload.confirmationId,
  );
  if (!resolver) return false;
  resolver({
    decision: payload.decision,
    feedback: payload.feedback,
  });
  return true;
}

export async function requestPlanConfirmation(
  host: PlanConfirmationHost,
  task: OrchestratorTask,
  nodes: {
    description: string;
    successCriteria: string;
    selectedSkillId?: string;
  }[],
  query: string,
  difficulty?: string,
): Promise<PlanConfirmationResult> {
  const confirmationId = crypto.randomUUID();

  sendStatus(
    task.workspaceId,
    AgentStatus.PAUSED,
    "Awaiting plan confirmation...",
  );
  sendMessage({
    type: "PLAN_CONFIRMATION_REQUEST",
    workspaceId: task.workspaceId,
    payload: {
      confirmationId,
      nodes: nodes.map((n) => ({
        description: n.description,
        successCriteria: n.successCriteria,
        ...(n.selectedSkillId ? { selectedSkillId: n.selectedSkillId } : {}),
      })),
      difficulty,
      query,
    },
  });
  void agentNotifications.notifyAttention({
    workspaceId: task.workspaceId,
    taskId: task.id,
    eventId: confirmationId,
    tabId: task.rootTabId,
    reason: "Plan confirmation required",
    detail: query,
  });

  logger.info("orchestrator", "Plan confirmation requested", {
    taskId: task.id,
    confirmationId,
    nodeCount: nodes.length,
  });

  return new Promise<PlanConfirmationResult>((resolve) => {
    host.pendingPlanConfirmationResolvers.register(
      confirmationId,
      (result) => {
        host.pendingPlanConfirmationResolvers.delete(confirmationId);
        logger.info("orchestrator", "Plan confirmation received", {
          taskId: task.id,
          confirmationId,
          decision: result.decision,
          hasFeedback: !!result.feedback,
        });
        host.emitTraceEvent(task, "plan_confirmation", {
          taskId: task.id,
          confirmationId,
          decision: result.decision,
          hasFeedback: !!result.feedback,
        }, "system");
        resolve(result);
      },
    );
  });
}
