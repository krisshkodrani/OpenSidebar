/**
 * Pending-user-interaction timing helpers + message builders (RFC LP-16
 * Phase 5; extended in pi-backend Phase 4). Pure — no messaging side effects;
 * the orchestrator sends what these build.
 */
import type {
  PendingApprovalInteraction,
  PendingUserInteraction,
} from "../agent/loop-types";

export function getPendingInteractionRemainingMs(
  interaction: PendingUserInteraction,
): number {
  return Math.max(
    0,
    interaction.timeoutMs - (Date.now() - interaction.requestedAt),
  );
}

export function isPendingInteractionResolved(
  interaction: PendingUserInteraction | undefined,
): boolean {
  if (!interaction) return false;
  return interaction.kind === "approval"
    ? typeof interaction.approved === "boolean"
    : typeof interaction.answer === "string";
}

/**
 * Approval window for tasks whose interactions are forwarded over the browser
 * bridge (pi-backend Phase 4): the answer round-trips through an external
 * agent and usually a human, so the default 30s is far too short.
 */
export const HANDOFF_APPROVAL_TIMEOUT_MS = 600_000;

interface PausedTaskLike {
  id: string;
  workspaceId: string;
  rootTabId: number;
  pendingInteraction?: PendingUserInteraction;
}

export interface PendingInteractionEmission {
  message:
    | {
        type: "APPROVAL_REQUEST";
        workspaceId: string;
        payload: {
          approvalId: string;
          toolName: string;
          args: Record<string, unknown>;
          risk: "high";
          context: string;
          timeoutMs: number;
        };
      }
    | {
        type: "CLARIFICATION_REQUEST";
        workspaceId: string;
        payload: {
          clarificationId: string;
          question: string;
          suggestions?: string[];
          timeoutMs: number;
        };
      };
  attention: {
    workspaceId: string;
    taskId: string;
    eventId: string;
    tabId: number;
    reason: string;
    detail: string;
  };
}

/**
 * Build the sidepanel APPROVAL_REQUEST / CLARIFICATION_REQUEST message + the
 * attention notification for a task's live pending interaction, or null when
 * there is nothing to emit (no interaction, resolved, or expired). Pure — the
 * orchestrator does the sending. Relocated from Orchestrator.emitPendingInteraction
 * (pi-backend Phase 4 loop-ratchet offset).
 */
export function emitPendingInteractionMessage(
  task: PausedTaskLike,
): PendingInteractionEmission | null {
  const interaction = task.pendingInteraction;
  if (!interaction || isPendingInteractionResolved(interaction)) return null;
  const remainingMs = getPendingInteractionRemainingMs(interaction);
  if (remainingMs <= 0) return null;

  if (interaction.kind === "approval") {
    return {
      message: {
        type: "APPROVAL_REQUEST",
        workspaceId: task.workspaceId,
        payload: {
          approvalId: interaction.approvalId,
          toolName: String(interaction.toolName),
          args: interaction.args,
          risk: "high",
          context: interaction.context,
          timeoutMs: remainingMs,
        },
      },
      attention: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        eventId: interaction.approvalId,
        tabId: task.rootTabId,
        reason: "Approval required",
        detail: interaction.context,
      },
    };
  }

  return {
    message: {
      type: "CLARIFICATION_REQUEST",
      workspaceId: task.workspaceId,
      payload: {
        clarificationId: interaction.clarificationId,
        question: interaction.question,
        suggestions: interaction.suggestions,
        timeoutMs: remainingMs,
      },
    },
    attention: {
      workspaceId: task.workspaceId,
      taskId: task.id,
      eventId: interaction.clarificationId,
      tabId: task.rootTabId,
      reason: "Clarification required",
      detail: interaction.question,
    },
  };
}

/**
 * Build the TASK_PAUSED broadcast for a task paused on an UNRESOLVED approval,
 * or null when there is nothing forwardable (no interaction, already resolved,
 * expired, or a clarification — clarification forwarding is deferred).
 * Emitted AFTER the orchestrator set `task.pendingInteraction`, so a consumer
 * that answers immediately always finds resolvable state.
 */
export function buildTaskPausedMessage(task: PausedTaskLike): {
  type: "TASK_PAUSED";
  workspaceId: string;
  payload: {
    taskId: string;
    interaction: {
      kind: "approval";
      approvalId: string;
      toolName: string;
      args: Record<string, unknown>;
      context: string;
      requestedAt: number;
      timeoutMs: number;
      expiresAt: number;
      dryRun?: PendingApprovalInteraction["dryRun"];
    };
  };
} | null {
  const interaction = task.pendingInteraction;
  if (!interaction || interaction.kind !== "approval") return null;
  if (isPendingInteractionResolved(interaction)) return null;
  if (getPendingInteractionRemainingMs(interaction) <= 0) return null;
  return {
    type: "TASK_PAUSED",
    workspaceId: task.workspaceId,
    payload: {
      taskId: task.id,
      interaction: {
        kind: "approval",
        approvalId: interaction.approvalId,
        toolName: String(interaction.toolName),
        args: interaction.args,
        context: interaction.context,
        requestedAt: interaction.requestedAt,
        timeoutMs: interaction.timeoutMs,
        expiresAt: interaction.requestedAt + interaction.timeoutMs,
        ...(interaction.dryRun ? { dryRun: interaction.dryRun } : {}),
      },
    },
  };
}
