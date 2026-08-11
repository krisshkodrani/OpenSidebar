import type {
  PortableCheckpointReason,
  PortableCheckpointV1,
} from "@shared-types/cloud-sessions";
import { validatePortableCheckpoint } from "@shared-types/portable-checkpoint-policy";
import type { OrchestratorCheckpoint, TaskNode } from "./types";

export type PortableCheckpointProjectionInput = {
  sessionId: string;
  checkpointId: string;
  parentCheckpointId?: string;
  revision: number;
  runtimeVersion: string;
  reason: PortableCheckpointReason;
  checkpoint: OrchestratorCheckpoint;
};

const iso = (timestamp: number) => new Date(timestamp).toISOString();

const nodeStatus = (node: TaskNode) => {
  if (node.status === "running") return "in_progress" as const;
  if (node.status === "completed" || node.status === "skipped")
    return "completed" as const;
  if (node.status === "failed") return "blocked" as const;
  return "pending" as const;
};

const expectedOrigins = (url: string | null | undefined) => {
  if (!url) return [];
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
};

const pendingState = (checkpoint: OrchestratorCheckpoint) => {
  const pending = checkpoint.task.pendingInteraction;
  if (!pending) return { kind: "none" as const };
  if (pending.kind === "clarification")
    return {
      kind: "clarification" as const,
      question: pending.question,
      askedAt: iso(pending.requestedAt),
    };
  return {
    kind: "approval_required" as const,
    actionSummary: pending.context || `Run ${pending.toolName}`,
    risk: "high" as const,
    requestedAt: iso(pending.requestedAt),
    expiresAt: iso(pending.requestedAt + pending.timeoutMs),
  };
};

export function projectPortableCheckpoint({
  sessionId,
  checkpointId,
  parentCheckpointId,
  revision,
  runtimeVersion,
  reason,
  checkpoint,
}: PortableCheckpointProjectionInput): PortableCheckpointV1 {
  const task = checkpoint.task;
  const completed = task.nodes.filter((node) => node.status === "completed");
  const partial = task.partialHandoff;
  const projected: PortableCheckpointV1 = {
    schemaVersion: 1,
    sessionId,
    checkpointId,
    ...(parentCheckpointId ? { parentCheckpointId } : {}),
    revision,
    createdAt: iso(checkpoint.savedAt),
    runtimeVersion,
    reason,
    objective: {
      originalRequest: task.query,
      currentInterpretation: task.query,
      successCriteria: task.nodes.map((node) => node.successCriteria),
      userConstraints: [],
    },
    conversation: {
      messages: [
        {
          id: "original-request",
          role: "user",
          content: task.query,
          createdAt: iso(task.createdAt),
          provenance: "user",
          uncertainty: "none",
        },
        ...(checkpoint.pendingFeedback ?? []).map((content, index) => ({
          id: `pending-feedback-${index + 1}`,
          role: "user" as const,
          content,
          createdAt: iso(checkpoint.savedAt),
          provenance: "user" as const,
          uncertainty: "none" as const,
        })),
      ],
    },
    execution: {
      plan: task.nodes.map((node) => ({
        stepId: node.id,
        description: node.description,
        status: nodeStatus(node),
        evidenceRefs: [],
      })),
      completedActions: completed.map((node) => ({
        actionId: node.id,
        kind: "completed_plan_step",
        summary: node.description,
        observedOutcome: node.userFacingResult ?? node.result ?? "Completed",
        evidenceType: "orchestrator_result",
      })),
      unresolvedFacts: [],
      ...(partial
        ? {
            partialHandoff: {
              completed: partial.completed.map((item) => item.text),
              remaining: partial.remaining.map((item) => item.text),
              uncertain: partial.uncertainty.map((item) => item.text),
            },
          }
        : {}),
    },
    grounding: {
      ...(task.rootTabUrl ? { lastKnownUrl: task.rootTabUrl } : {}),
      expectedOrigins: expectedOrigins(task.rootTabUrl),
      userVisibleStateSummary:
        task.nodes[task.currentIndex]?.description ?? task.query,
      requiredCapabilities: ["navigation"],
    },
    pending: pendingState(checkpoint),
    usage: {
      promptTokens: task.sessionMetrics.totalPromptTokens,
      completionTokens: task.sessionMetrics.totalCompletionTokens,
      cachedTokens: 0,
      imageTokenEstimate:
        task.sessionMetrics.totalImagePromptTokenEstimate ?? 0,
      turns: task.sessionMetrics.llmCallCount,
    },
  };
  const validation = validatePortableCheckpoint(projected);
  if (!validation.valid)
    throw new Error(`portable_checkpoint_${validation.code}:${validation.path}`);
  return validation.value;
}
